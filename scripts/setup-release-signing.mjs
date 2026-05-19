#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const ROOT = process.cwd();
const KEY_DIR = path.join(ROOT, ".trova", "release");
const PRIVATE_KEY_PATH = path.join(KEY_DIR, "tauri-updater.key");
const GENERATED_PUBLIC_KEY_PATH = `${PRIVATE_KEY_PATH}.pub`;
const PUBLIC_KEY_PATH = path.join(KEY_DIR, "tauri-updater.pub");
const ENV_PATH = path.join(KEY_DIR, "release.env");
const RELEASE_CONFIG_PATH = path.join(ROOT, "src-tauri", "tauri.release.conf.json");
const force = process.argv.includes("--force");

await fs.mkdir(KEY_DIR, { recursive: true });

const privateExists = await exists(PRIVATE_KEY_PATH);
if (!privateExists || force) {
  const { stdout, stderr } = await execFile("npm", [
    "run",
    "tauri",
    "--",
    "signer",
    "generate",
    "--ci",
    "--force",
    "--write-keys",
    PRIVATE_KEY_PATH,
  ], {
    cwd: ROOT,
    timeout: 120_000,
    maxBuffer: 500_000,
  });
  const publicKey = extractPublicKey(`${stdout}\n${stderr}`);
  if (publicKey) await fs.writeFile(PUBLIC_KEY_PATH, `${publicKey}\n`, { mode: 0o644 });
}

await fs.chmod(PRIVATE_KEY_PATH, 0o600).catch(() => {});

const publicKey = (
  await fs.readFile(PUBLIC_KEY_PATH, "utf8").catch(async () =>
    fs.readFile(GENERATED_PUBLIC_KEY_PATH, "utf8").catch(() => ""),
  )
).trim();
if (publicKey) await fs.writeFile(PUBLIC_KEY_PATH, `${publicKey}\n`, { mode: 0o644 });
if (publicKey) await syncReleaseConfig(publicKey);
const privateKey = (await fs.readFile(PRIVATE_KEY_PATH, "utf8")).trim();
const envContent = [
  "# Local Trova release signing env. Do not commit.",
  `TAURI_SIGNING_PRIVATE_KEY=${privateKey}`,
  `TAURI_SIGNING_PRIVATE_KEY_PATH=${PRIVATE_KEY_PATH}`,
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD=",
  publicKey ? `TAURI_UPDATER_PUBLIC_KEY=${publicKey}` : "",
  "",
].filter((line) => line !== "").join("\n");
await fs.writeFile(ENV_PATH, `${envContent}\n`, { mode: 0o600 });

console.log([
  "OK chiave updater locale pronta",
  `Private key: ${PRIVATE_KEY_PATH}`,
  `Env locale: ${ENV_PATH}`,
  publicKey ? `Public key: ${publicKey}` : "Public key: non rilevata automaticamente",
  publicKey ? `Release config aggiornata: ${RELEASE_CONFIG_PATH}` : "",
].join("\n"));

async function exists(filePath) {
  return fs.stat(filePath).then((stat) => stat.isFile()).catch(() => false);
}

function extractPublicKey(output) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const explicit = lines.find((line) => /public key/i.test(line));
  if (explicit) {
    return explicit.replace(/^.*public key[:\s]+/i, "").trim();
  }
  return lines.find((line) => /^[A-Za-z0-9+/=]{40,}$/.test(line)) || "";
}

async function syncReleaseConfig(publicKey) {
  const config = JSON.parse(await fs.readFile(RELEASE_CONFIG_PATH, "utf8"));
  config.plugins = config.plugins || {};
  config.plugins.updater = {
    ...(config.plugins.updater || {}),
    pubkey: publicKey,
    endpoints: config.plugins.updater?.endpoints?.length
      ? config.plugins.updater.endpoints
      : ["https://github.com/OWNER/REPO/releases/latest/download/latest.json"],
  };
  await fs.writeFile(RELEASE_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}
