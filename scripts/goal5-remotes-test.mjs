import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const ROOT = process.cwd();
const API_URL = process.env.TROVA_LOCAL_API_URL || "http://127.0.0.1:17654/api/command";
const STATE_PATH = path.join(ROOT, ".trova", "local-api-state.json");
const FIXTURE_DIR = path.join(ROOT, ".trova", "test-fixtures", "goal5-remote-source");
const CLI = path.join(ROOT, "scripts", "trova-cli.mjs");
const checks = [];
const previousState = await fs.readFile(STATE_PATH, "utf8").catch(() => "");

try {
  await writeFixtures();
  // Stato pulito: niente watch paths predefiniti che possono essere enormi (es. home utente).
  await fs.writeFile(STATE_PATH, JSON.stringify({ watchPaths: [], connectors: [], index: [] }));
  const connector = {
    id: "goal5-local-remote",
    name: "Goal 5 local remote",
    provider: "local",
    sourceType: "remote",
    remotePath: FIXTURE_DIR,
    enabled: true,
    readOnly: true,
    autoSync: true,
    geminiEnabled: false,
    recursive: true,
    syncMode: "cache",
    fileTypeFilter: { mode: "include", extensions: [".txt"] },
  };

  const rclone = await command("get_rclone_status", {});
  assert(rclone.providers.some((item) => item.id === "drive"), "stato rclone espone cloud provider");
  assert(rclone.providers.some((item) => item.id === "sftp"), "stato rclone espone network provider");

  const saved = await command("save_connectors", { connectors: [connector] });
  assert(saved.connectors.some((item) => item.id === connector.id), "connector remote salvato");
  assert(saved.watchPaths.some((item) => item.remoteId === connector.id), "watch path cache remoto creato");

  const tested = await command("test_remote_connector", { id: connector.id });
  assert(tested.ok && tested.sample.length >= 1, "test connector local remote legge sorgente reale");

  const synced = await command("sync_remote_connector", { id: connector.id });
  assert(synced.ok && synced.filesSynced >= 2, `sync remote crea cache locale: ${synced.filesSynced} file`);
  assert(await exists(path.join(synced.connector.cachePath, "remote-elefante.txt")), "cache contiene file remoto copiato");

  const indexed = await command("start_indexing", { paths: synced.watchPaths });
  assert(indexed.filesIndexed >= 1, "indice legge cache remota");

  const results = await search("elefante remote glicine");
  const remoteResult = results.find((item) => item.name === "remote-elefante.txt");
  assert(Boolean(remoteResult), "ricerca trova testo dentro remote sincronizzato");

  const context = await command("get_file_context", { request: { filePath: remoteResult.path } });
  assert(context.sourceType === "remote" && context.remoteId === connector.id, "contesto conserva metadata remote");

  await fs.writeFile(path.join(FIXTURE_DIR, "remote-sync-all.txt"), "webdav simulato e sync all locale con rclone cache.");
  const syncAll = await command("sync_all_remotes", {});
  assert(syncAll.synced >= 1 && syncAll.errors === 0, "sync_all_remotes aggiorna connector auto-sync");
  // Filtra a soli watch paths remoti per evitare di indicizzare l'intera home utente in CI/locale.
  const allPaths = await command("load_watch_paths", {});
  const paths = allPaths.filter((item) => item.sourceType === "remote");
  await command("start_indexing", { paths });
  const updated = await search("webdav simulato");
  assert(updated.some((item) => item.name === "remote-sync-all.txt"), "auto-sync rende cercabile nuovo file remoto");

  const cliList = await cliJson(["remotes", "list"]);
  assert(cliList.some((item) => item.id === connector.id), "CLI remotes list usa backend reale");
  const cliSync = await cliJson(["remotes", "sync", connector.id]);
  assert(cliSync.ok && cliSync.filesSynced >= 2, "CLI remotes sync sincronizza connector reale");

  console.log(checks.map((item) => `${item.ok ? "OK" : "FAIL"} ${item.label}`).join("\n"));
} finally {
  if (previousState) await fs.writeFile(STATE_PATH, previousState);
}

async function writeFixtures() {
  await fs.rm(FIXTURE_DIR, { recursive: true, force: true });
  await fs.mkdir(path.join(FIXTURE_DIR, "nested"), { recursive: true });
  await fs.writeFile(
    path.join(FIXTURE_DIR, "remote-elefante.txt"),
    "Un elefante remote con glicine passa da connector locale, cache rclone e indice Trova.",
  );
  await fs.writeFile(
    path.join(FIXTURE_DIR, "nested", "remote-sftp.txt"),
    "Fixture nested per simulare una sorgente SFTP, SMB o WebDAV sincronizzata in cache.",
  );
  await fs.writeFile(
    path.join(FIXTURE_DIR, "ignored.bin"),
    "Questo file resta copiato in cache ma viene escluso dall'indice dal filtro estensione.",
  );
}

async function search(textQuery) {
  return command("search_index", {
    request: {
      textQuery,
      mode: "text",
      filters: ["all"],
      useLocal: true,
      useGemini: false,
      semantic: true,
      fuzzy: true,
    },
  });
}

async function command(commandName, args) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: commandName, args }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `${commandName} failed`);
  return payload.result;
}

async function cliJson(args) {
  const { stdout } = await execFile("node", [CLI, ...args, "--json"], {
    cwd: ROOT,
    timeout: 120_000,
    maxBuffer: 5_000_000,
  });
  return JSON.parse(stdout);
}

async function exists(filePath) {
  return fs.access(filePath).then(() => true, () => false);
}

function assert(ok, label) {
  checks.push({ ok, label });
  if (!ok) throw new Error(label);
}
