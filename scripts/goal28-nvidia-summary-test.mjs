#!/usr/bin/env node
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const API_PORT = 18940 + Math.floor(Math.random() * 500);
const API_URL = `http://127.0.0.1:${API_PORT}/api/command`;
const DATA_DIR = path.join(ROOT, ".trova", "test-fixtures", "goal28-data");
const DOC_DIR = path.join(DATA_DIR, "documents");
const checks = [];

let apiProcess = null;

try {
  await fs.rm(DATA_DIR, { recursive: true, force: true });
  await fs.mkdir(DOC_DIR, { recursive: true });
  const filePath = path.join(DOC_DIR, "relazione-elefante.txt");
  await fs.writeFile(filePath, [
    "Relazione sull'elefante africano.",
    "Il documento parla di habitat, alimentazione, acqua, migrazioni e cura del branco.",
    "Serve come esempio per verificare una preview con riassunto AI dentro Trova.",
    "La ricerca deve trovare il testo, aprire la preview e preparare punti chiave leggibili.",
  ].join("\n"));

  apiProcess = spawn("node", ["scripts/local-backend.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TROVA_LOCAL_API_PORT: String(API_PORT),
      TROVA_DATA_DIR: DATA_DIR,
      TROVA_DISABLE_TRANSFORMERS: "1",
      TROVA_NVIDIA_MOCK_SUMMARY: "1",
      NVIDIA_API_KEY: "nvapi-test-key-abcdefghijklmnopqrstuvwxyz",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const bootOutput = [];
  apiProcess.stdout.on("data", (chunk) => bootOutput.push(String(chunk)));
  apiProcess.stderr.on("data", (chunk) => bootOutput.push(String(chunk)));
  await waitForApi();

  const paths = [{
    id: "goal28",
    path: DOC_DIR,
    enabled: true,
    recursive: true,
    isExcluded: false,
    geminiEnabled: false,
    autoIndex: true,
    sourceType: "local",
  }];
  await command("save_watch_paths", { paths });
  const status = await command("start_indexing", { paths });
  assert(status.filesIndexed >= 1, "Documento test indicizzato");

  let blockedWithoutConsent = false;
  try {
    await command("summarize_file_with_nvidia", { request: { filePath } });
  } catch {
    blockedWithoutConsent = true;
  }
  assert(blockedWithoutConsent, "Riassunto NVIDIA richiede consenso esplicito");

  const summary = await command("summarize_file_with_nvidia", {
    request: { filePath, consent: true, maxChars: 5000 },
  });
  assert(summary.provider === "nvidia", "Provider NVIDIA restituito");
  assert(summary.model === "deepseek-ai/deepseek-v4-flash", "Usa DeepSeek V4 Flash");
  assert(summary.summary.includes("test"), "Riassunto AI ricevuto");
  assert(Array.isArray(summary.bullets) && summary.bullets.length >= 2, "Punti chiave disponibili");

  const cached = await command("summarize_file_with_nvidia", {
    request: { filePath, consent: true, maxChars: 5000 },
  });
  assert(cached.fromCache, "Riassunto salvato in cache locale");

  const discovered = await command("discover_api_keys", {});
  assert(discovered.nvidiaFound, "Chiave NVIDIA rilevata");
  assert(discovered.nvidiaKeyCount >= 1, "Conteggio chiavi NVIDIA disponibile");
  assert(!JSON.stringify(discovered).includes("abcdefghijklmnopqrstuvwxyz"), "Le chiavi non escono dalla API diagnostica");

  console.log(checks.map((check) => `OK ${check}`).join("\n"));
} catch (err) {
  console.error(checks.map((check) => `OK ${check}`).join("\n"));
  console.error(`FAIL ${err?.message || err}`);
  process.exitCode = 1;
} finally {
  if (apiProcess) apiProcess.kill("SIGTERM");
}

function assert(ok, label) {
  if (!ok) throw new Error(label);
  checks.push(label);
}

async function command(commandName, args = {}) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: commandName, args }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `${commandName} failed`);
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
  throw new Error("Local API goal28 non partita.");
}
