#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const ROOT = process.cwd();
const checks = [];

try {
  const packageJson = await readJson(path.join(ROOT, "package.json"));
  assert(packageJson.scripts?.["release:status"], "script release:status presente");
  assert(packageJson.scripts?.["release:setup-signing"], "script release:setup-signing presente");
  assert(packageJson.scripts?.["release:manifest"], "script release:manifest presente");
  assert(packageJson.scripts?.["release:build"], "script release:build presente");
  assert(packageJson.scripts?.["test:goal10"], "script test:goal10 presente");

  const releaseConfig = await readJson(path.join(ROOT, "src-tauri", "tauri.release.conf.json"));
  assert(releaseConfig.bundle?.createUpdaterArtifacts === true, "config release genera updater artifacts firmati");
  assert(Boolean(releaseConfig.plugins?.updater?.pubkey), "config release contiene public key updater");
  assert((releaseConfig.plugins?.updater?.endpoints || []).length > 0, "config release contiene endpoint updater");
  assert(releaseConfig.bundle?.macOS?.hardenedRuntime === true, "config release abilita hardened runtime macOS");
  assert(releaseConfig.bundle?.windows?.digestAlgorithm === "sha256", "config release usa sha256 su Windows");
  assert(await fileExists(path.join(ROOT, "src-tauri", "entitlements.plist")), "entitlements macOS presenti");

  const workflow = await fs.readFile(path.join(ROOT, ".github", "workflows", "release.yml"), "utf8");
  assert(workflow.includes("ubuntu-24.04"), "workflow builda Linux");
  assert(workflow.includes("windows-2025"), "workflow builda Windows");
  assert(workflow.includes("macos-15"), "workflow builda macOS");
  assert(workflow.includes("node scripts/trova-release.mjs build"), "workflow usa release builder reale");
  assert(workflow.includes("actions/upload-artifact@v4"), "workflow carica artifact installer");

  const status = JSON.parse((await execFile("node", ["scripts/trova-release.mjs", "status", "--json"], {
    cwd: ROOT,
    timeout: 60_000,
    maxBuffer: 1_000_000,
  })).stdout);
  assert(status.ready, "release preflight progetto pronto");
  assert(status.signing.expectedSecrets.updater.includes("TAURI_SIGNING_PRIVATE_KEY"), "preflight dichiara secret updater");
  assert(status.signing.updater, "preflight trova chiave updater locale");
  assert(Array.isArray(status.bundle.files), "preflight legge artifact bundle");

  const cliStatus = JSON.parse((await execFile("node", ["scripts/trova-cli.mjs", "release", "status", "--json"], {
    cwd: ROOT,
    timeout: 60_000,
    maxBuffer: 1_000_000,
  })).stdout);
  assert(cliStatus.bundle.productName === "Trova", "CLI release status usa lo stesso script");

  await execFile("node", ["scripts/trova-release.mjs", "manifest"], {
    cwd: ROOT,
    timeout: 60_000,
    maxBuffer: 1_000_000,
  });
  const manifest = await readJson(path.join(ROOT, "dist", "release", "latest.json"));
  assert(manifest.version === packageJson.version, "manifest updater usa versione app");
  assert(Array.isArray(manifest.artifacts), "manifest updater contiene lista artifact");
  if (status.bundle.files.length) {
    assert(manifest.artifacts.length >= status.bundle.files.length, "manifest include artifact reali gia costruiti");
    assert(Object.keys(manifest.platforms).length > 0, "manifest espone piattaforme update");
    assert(manifest.artifacts.every((artifact) => artifact.signature), "manifest include firme updater reali");
  }

  console.log(checks.map((check) => `OK ${check}`).join("\n"));
} catch (err) {
  console.error(checks.map((check) => `OK ${check}`).join("\n"));
  console.error(`FAIL ${err.message || err}`);
  process.exit(1);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function fileExists(filePath) {
  return fs.stat(filePath).then((stat) => stat.isFile()).catch(() => false);
}

function assert(condition, label) {
  if (!condition) throw new Error(label);
  checks.push(label);
}
