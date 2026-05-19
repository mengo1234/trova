#!/usr/bin/env node
import { execFile as execFileCallback, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const ROOT = process.cwd();
const GOAL8_DATA_DIR = path.join(ROOT, ".trova", "test-fixtures", "goal8-data");
const API_PORT = 18754 + Math.floor(Math.random() * 400);
const API_URL = `http://127.0.0.1:${API_PORT}/api/command`;
const checks = [];

let apiProcess = null;

try {
  await fs.mkdir(GOAL8_DATA_DIR, { recursive: true });

  const packageJson = await readJson(path.join(ROOT, "package.json"));
  assert(packageJson.scripts?.["package:preflight"], "script package:preflight presente");
  assert(packageJson.scripts?.["package:desktop"], "script package:desktop presente");
  assert(packageJson.scripts?.["test:goal8"], "script test:goal8 presente");

  const tauriConfig = await readJson(path.join(ROOT, "src-tauri", "tauri.conf.json"));
  assert((tauriConfig.bundle?.icon || []).includes("icons/icon.png"), "Tauri usa icona app reale");
  assert((tauriConfig.bundle?.resources || []).some((item) => String(item).includes("local-backend")), "Tauri include backend locale tra le risorse");

  const preflight = JSON.parse((await execFile("node", ["scripts/trova-package.mjs", "preflight", "--json"], {
    cwd: ROOT,
    timeout: 30_000,
    maxBuffer: 1_000_000,
  })).stdout);
  assert(preflight.ready, "preflight packaging pronto sulla piattaforma corrente");
  assert(preflight.checks.some((check) => check.id === "local-api" && check.ok), "preflight vede API locale completa");

  const mainSource = await fs.readFile(path.join(ROOT, "src", "main.tsx"), "utf8");
  assert(mainSource.includes("ensure_local_api"), "frontend desktop avvia API locale Tauri");
  assert(mainSource.includes("ensureDesktopLocalApi"), "frontend usa bootstrap API prima dei comandi");

  apiProcess = spawn("node", ["scripts/local-backend.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TROVA_LOCAL_API_PORT: String(API_PORT),
      TROVA_DATA_DIR: GOAL8_DATA_DIR,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const bootOutput = [];
  apiProcess.stdout.on("data", (chunk) => bootOutput.push(String(chunk)));
  apiProcess.stderr.on("data", (chunk) => bootOutput.push(String(chunk)));
  await waitForApi();

  const packaging = await command("get_packaging_status", {});
  assert(packaging.readyForCurrentPlatform, "backend espone packaging status pronto");
  assert(packaging.dataDir === GOAL8_DATA_DIR, "backend rispetta TROVA_DATA_DIR per app installata");
  assert(packaging.bundle.icons.includes("icons/icon.png"), "backend legge icona bundle");

  const bootstrap = await command("bootstrap_local_runtime", {});
  assert(bootstrap.ok, "bootstrap runtime locale riuscito");
  assert(bootstrap.components.some((component) => component.id === "desktop-runtime"), "componenti includono Desktop runtime");
  assert(await isDirectory(path.join(GOAL8_DATA_DIR, "models")), "bootstrap crea cache modelli locale");
  assert(await isDirectory(path.join(GOAL8_DATA_DIR, "remotes")), "bootstrap crea cache remote locale");

  console.log(checks.map((check) => `OK ${check}`).join("\n"));
} catch (err) {
  console.error(checks.map((check) => `OK ${check}`).join("\n"));
  console.error(`FAIL ${err.message || err}`);
  process.exitCode = 1;
} finally {
  if (apiProcess) {
    apiProcess.kill("SIGTERM");
  }
}

async function command(commandName, args) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: commandName, args }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `${commandName} fallito`);
  }
  return payload.result;
}

async function waitForApi() {
  const started = Date.now();
  while (Date.now() - started < 12_000) {
    try {
      await command("get_index_status", {});
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`API goal8 non partita. Output:\n${bootOutput.join("")}`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function isDirectory(filePath) {
  return fs.stat(filePath).then((stat) => stat.isDirectory()).catch(() => false);
}

function assert(condition, label) {
  if (!condition) throw new Error(label);
  checks.push(label);
}
