import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { constants as fsConstants, existsSync, promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";
import chokidar from "chokidar";

const PORT = Number(process.env.TROVA_LOCAL_API_PORT || 17654);
const ROOT = process.env.TROVA_ROOT || process.cwd();
const DATA_DIR = process.env.TROVA_DATA_DIR || path.join(ROOT, ".trova");
const STATE_PATH = path.join(DATA_DIR, "local-api-state.json");
const PREVIEW_DIR = path.join(DATA_DIR, "previews");
const KEYFRAME_DIR = path.join(DATA_DIR, "keyframes");
const TRANSCRIPT_DIR = path.join(DATA_DIR, "transcripts");
const OCR_DIR = path.join(DATA_DIR, "ocr");
const MODEL_DIR = path.join(DATA_DIR, "models");
const QUERY_DIR = path.join(DATA_DIR, "queries");
const REMOTE_DIR = path.join(DATA_DIR, "remotes");
const BIN_DIR = path.join(DATA_DIR, "bin");
const RUNTIME_DIR = path.join(DATA_DIR, "runtime");
const AI_SUMMARY_DIR = path.join(DATA_DIR, "ai-summaries");
const DIAGNOSTIC_LOG = path.join(DATA_DIR, "trova-doctor.json");
const REMOTE_ACCESS_LOG = path.join(DATA_DIR, "remote-access.log");
const TYPESENSE_URL = process.env.TROVA_TYPESENSE_URL || "http://127.0.0.1:8108";
const TYPESENSE_API_KEY = process.env.TYPESENSE_API_KEY || "trova-typesense-key";
const TYPESENSE_COLLECTION = process.env.TROVA_TYPESENSE_COLLECTION || "trova_files_core";
const NVIDIA_CHAT_URL = process.env.TROVA_NVIDIA_CHAT_URL || "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_CHAT_MODEL = process.env.TROVA_NVIDIA_CHAT_MODEL || "deepseek-ai/deepseek-v4-flash";
const TEXT_EMBEDDING_MODEL = process.env.TROVA_TEXT_EMBEDDING_MODEL || "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const LEXICAL_EMBEDDING_MODEL = "trova-lexical-v1";
const VISUAL_FINGERPRINT_MODEL = "trova-fingerprint-v1";
const FACE_FINGERPRINT_MODEL = "trova-face-explicit-v1";
const VISUAL_INDEX_VERSION = "visual-v3";
const TEXT_EMBEDDING_DIM = 384;
const VISUAL_FINGERPRINT_DIM = 195;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_TEXT_BYTES = 700_000;
const MAX_FILES = 8000;
const MAX_TEXT_CHUNKS_PER_FILE = Number(process.env.TROVA_MAX_TEXT_CHUNKS_PER_FILE || 24);
const WATCHER_DEBOUNCE_MS = 850;
const WATCHER_BATCH_LIMIT = 80;
const execFile = promisify(execFileCallback);
const RCLONE_PROVIDERS = [
  { id: "ftp", label: "FTP", type: "network" },
  { id: "sftp", label: "SFTP", type: "network" },
  { id: "smb", label: "SMB", type: "network" },
  { id: "webdav", label: "WebDAV", type: "network" },
  { id: "drive", label: "Google Drive", type: "cloud" },
  { id: "dropbox", label: "Dropbox", type: "cloud" },
  { id: "s3", label: "S3", type: "cloud" },
  { id: "onedrive", label: "OneDrive", type: "cloud" },
  { id: "box", label: "Box", type: "cloud" },
  { id: "local", label: "Cartella locale via cache", type: "local" },
];

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"]);
const DOC_EXT = new Set(["pdf", "docx", "txt", "md", "rtf", "odt", "pptx", "xlsx", "csv"]);
const CODE_EXT = new Set(["js", "jsx", "ts", "tsx", "py", "rs", "go", "java", "c", "cpp", "h", "css", "html", "json", "toml", "yaml", "yml"]);
const AUDIO_EXT = new Set(["mp3", "wav", "flac", "m4a", "ogg"]);
const VIDEO_EXT = new Set(["mp4", "mov", "mkv", "avi", "webm"]);

await fs.mkdir(DATA_DIR, { recursive: true });
await fs.mkdir(PREVIEW_DIR, { recursive: true });
await fs.mkdir(KEYFRAME_DIR, { recursive: true });
await fs.mkdir(TRANSCRIPT_DIR, { recursive: true });
await fs.mkdir(OCR_DIR, { recursive: true });
await fs.mkdir(MODEL_DIR, { recursive: true });
await fs.mkdir(QUERY_DIR, { recursive: true });
await fs.mkdir(REMOTE_DIR, { recursive: true });
await fs.mkdir(BIN_DIR, { recursive: true });
await fs.mkdir(RUNTIME_DIR, { recursive: true });
await fs.mkdir(AI_SUMMARY_DIR, { recursive: true });

let activeWatcher = null;
let watcherDebounceTimer = null;
let watcherBusy = false;
let lastTypesenseError = "";
let textEmbedderPromise = null;
let activeRemoteAccessServer = null;
let activeRemoteAccessConfig = null;
let activeAutoSetupPromise = null;
let nvidiaKeyCursor = 0;
let textEmbeddingStatus = {
  model: TEXT_EMBEDDING_MODEL,
  ready: false,
  fallback: false,
  error: "",
};
const watcherQueue = new Map();

createServer(async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return endJson(res, {});
  if (req.method !== "POST" || req.url !== "/api/command") {
    res.writeHead(404);
    return res.end("not found");
  }

  try {
    const { command, args = {} } = JSON.parse(await readBody(req) || "{}");
    const result = await handleCommand(command, args);
    endJson(res, { ok: true, result });
  } catch (err) {
    endJson(res, { ok: false, error: String(err?.message || err) }, 500);
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Trova local API pronta su http://127.0.0.1:${PORT}`);
  void resumeWatcherIfNeeded();
  void resumeRemoteAccessIfNeeded();
});

async function handleCommand(command, args) {
  if (command === "get_default_watch_paths") {
    return defaultWatchPaths();
  }
  if (command === "load_watch_paths") {
    const state = await loadState();
    if (state.watchPaths?.length) {
      const upgraded = upgradeDefaultWatchPaths(state);
      if (upgraded.changed) await saveState(state);
      return state.watchPaths;
    }
    return defaultWatchPaths();
  }
  if (command === "save_watch_paths") {
    const state = await loadState();
    state.watchPaths = args.paths || [];
    state.watcherRoots = watcherRoots(state.watchPaths);
    await saveState(state);
    if (state.watcherActive) await startFileWatcher(state.watchPaths);
    return state.watchPaths;
  }
  if (command === "get_index_status") {
    const state = await loadState();
    return indexStatus(state);
  }
  if (command === "get_semantic_status") {
    const state = await loadState();
    return semanticStatus(state);
  }
  if (command === "start_watcher") {
    const state = await loadState();
    if (args.paths?.length) state.watchPaths = args.paths;
    await startFileWatcher(state.watchPaths);
    state.watcherActive = true;
    state.watcherStartedAt = Date.now();
    state.watcherRoots = watcherRoots(state.watchPaths);
    state.watcherError = "";
    await saveState(state);
    return indexStatus(state);
  }
  if (command === "stop_watcher") {
    await stopFileWatcher();
    const state = await loadState();
    state.watcherActive = false;
    state.watcherStoppedAt = Date.now();
    await saveState(state);
    return indexStatus(state);
  }
  if (command === "get_local_vision_status") {
    const state = await loadState();
    return localVisionStatus(state);
  }
  if (command === "get_local_components") {
    const state = await loadState();
    return localComponentsStatus(state);
  }
  if (command === "get_doctor_status") {
    const state = await loadState();
    return doctorStatus(state);
  }
  if (command === "get_simple_app_status") {
    const state = await loadState();
    return simpleAppStatus(state);
  }
  if (command === "start_auto_setup" || command === "install_everything") {
    return startAutoSetup(args || {});
  }
  if (command === "get_auto_setup_status") {
    const state = await loadState();
    return state.autoSetupJob || emptyAutoSetupJob();
  }
  if (command === "repair_app") {
    return repairApp(args || {});
  }
  if (command === "export_diagnostic_log") {
    const state = await loadState();
    return exportDiagnosticLog(state);
  }
  if (command === "get_model_status" || command === "model_status") {
    const state = await loadState();
    return modelStatus(state);
  }
  if (command === "warmup_local_models") {
    return warmupLocalModels(args || {});
  }
  if (command === "get_packaging_status") {
    return packagingStatus();
  }
  if (command === "bootstrap_local_runtime") {
    return bootstrapLocalRuntime();
  }
  if (command === "get_rclone_status") {
    const state = await loadState();
    return rcloneStatus(state);
  }
  if (command === "get_connectors") {
    const state = await loadState();
    return state.connectors || [];
  }
  if (command === "save_connectors") {
    const state = await loadState();
    state.connectors = normalizeConnectors(args.connectors || []);
    state.watchPaths = syncRemoteWatchPaths(state.watchPaths || defaultWatchPaths(), state.connectors);
    await saveState(state);
    return { connectors: state.connectors, watchPaths: state.watchPaths };
  }
  if (command === "test_remote_connector") {
    const state = await loadState();
    const connector = normalizeConnector(args.connector || findConnector(state, args.id));
    const tested = await testRemoteConnector(connector);
    state.connectors = upsertConnector(state.connectors || [], tested.connector);
    await saveState(state);
    return tested;
  }
  if (command === "sync_remote_connector") {
    const state = await loadState();
    const connector = normalizeConnector(args.connector || findConnector(state, args.id));
    const result = await syncRemoteConnector(connector);
    state.connectors = upsertConnector(state.connectors || [], result.connector);
    state.watchPaths = upsertRemoteWatchPath(state.watchPaths || defaultWatchPaths(), result.connector);
    await saveState(state);
    return { ...result, watchPaths: state.watchPaths };
  }
  if (command === "sync_all_remotes") {
    const state = await loadState();
    const result = await syncAutoRemoteConnectors(state);
    await saveState(result.state);
    return result.summary;
  }
  if (command === "create_rclone_remote") {
    return createRcloneRemote(args.request || args);
  }
  if (command === "get_remote_access_status" || command === "remote_access_status") {
    const state = await loadState();
    return remoteAccessStatus(state);
  }
  if (command === "configure_remote_access") {
    const state = await loadState();
    state.remoteAccess = normalizeRemoteAccessConfig({ ...(state.remoteAccess || {}), ...(args.config || args || {}) });
    await saveState(state);
    if (!state.remoteAccess.enabled) await stopRemoteAccessServer();
    return remoteAccessStatus(state);
  }
  if (command === "start_remote_access") {
    const state = await loadState();
    state.remoteAccess = normalizeRemoteAccessConfig({ ...(state.remoteAccess || {}), ...(args.config || args || {}), enabled: true });
    await startRemoteAccessServer(state.remoteAccess);
    await saveState(state);
    return remoteAccessStatus(state, true);
  }
  if (command === "stop_remote_access") {
    const state = await loadState();
    state.remoteAccess = normalizeRemoteAccessConfig({ ...(state.remoteAccess || {}), enabled: false });
    await stopRemoteAccessServer();
    await saveState(state);
    return remoteAccessStatus(state);
  }
  if (command === "install_local_component") {
    return installLocalComponent(args.id);
  }
  if (command === "discover_api_keys") {
    return discoverApiKeys();
  }
  if (command === "start_indexing") {
    const watchPaths = args.paths?.length ? args.paths : defaultWatchPaths();
    const previous = await loadState();
    const syncResult = await syncAutoRemoteConnectors({
      ...previous,
      watchPaths,
      connectors: previous.connectors || [],
    });
    const effectiveWatchPaths = syncResult.state.watchPaths || watchPaths;
    const { index, stats } = await buildIndex(effectiveWatchPaths, previous.index || []);
    const state = {
      ...syncResult.state,
      watchPaths: effectiveWatchPaths,
      index,
      lastIndexStats: { ...stats, remotesSynced: syncResult.summary.synced, remoteErrors: syncResult.summary.errors },
      lastIndexedAt: Date.now(),
      watcherRoots: watcherRoots(effectiveWatchPaths),
    };
    await saveState(state);
    await syncTypesenseIndex(index).catch((err) => rememberTypesenseError(err));
    if (state.watcherActive) await startFileWatcher(effectiveWatchPaths);
    return indexStatus(state);
  }
  if (command === "search_index") {
    const state = await loadState();
    return searchIndex(state.index || [], args.request || {});
  }
  if (command === "find_similar_files") {
    const state = await loadState();
    return findSimilarFiles(state.index || [], args.request || {});
  }
  if (command === "ask_files") {
    const state = await loadState();
    return askFiles(state.index || [], args.request || {});
  }
  if (command === "chat_with_files") {
    const state = await loadState();
    const answer = await askFiles(state.index || [], args.request || {});
    const threadId = args.request?.threadId || hash(`${Date.now()}:${args.request?.question || ""}`).slice(0, 16);
    state.chatThreads ||= {};
    state.chatThreads[threadId] ||= [];
    state.chatThreads[threadId].push({ role: "user", content: String(args.request?.question || ""), createdAt: Date.now() });
    state.chatThreads[threadId].push({ role: "assistant", content: answer.answer, citations: answer.citations, createdAt: Date.now() });
    await saveState(state);
    return { ...answer, threadId, messages: state.chatThreads[threadId] };
  }
  if (command === "get_file_context") {
    const state = await loadState();
    return getFileContext(state.index || [], args.request || args || {});
  }
  if (command === "summarize_file_with_nvidia") {
    const state = await loadState();
    return summarizeFileWithNvidia(state.index || [], args.request || args || {});
  }
  if (command === "get_nvidia_ai_status") {
    return nvidiaAiStatus();
  }
  if (command === "clear_index") {
    const state = await loadState();
    state.index = [];
    state.lastIndexStats = { filesDiscovered: 0, filesIndexed: 0, filesSkipped: 0, unchanged: 0, errors: 0 };
    await saveState(state);
    await syncTypesenseIndex([]).catch((err) => rememberTypesenseError(err));
    return indexStatus(state);
  }
  if (command === "rerank_with_nvidia") {
    return rerankWithNvidia(args.request || {});
  }
  if (command === "list_gemini_candidates") {
    const state = await loadState();
    return (state.index || [])
      .filter((entry) => entry.geminiEnabled && ["pdf", "docx", "txt", "md", "png", "jpg", "jpeg"].includes(entry.extension))
      .slice(0, 120)
      .map((entry) => ({
        path: entry.filePath,
        name: entry.name,
        mimeType: mime(entry.extension),
        size: entry.size,
        modified: entry.modified,
      }));
  }
  if (command === "read_file_base64") {
    const bytes = await fs.readFile(args.path);
    return bytes.toString("base64");
  }
  if (command === "read_image_data_url") {
    return readImageDataUrl(args.path);
  }
  if (command === "read_file_data_url") {
    return readFileDataUrl(args.path);
  }
  if (command === "open_in_folder") {
    await openInFolder(args.path);
    return null;
  }
  if (command === "list_visual_assets") {
    const state = await loadState();
    return listVisualAssets(state);
  }
  if (command === "update_visual_asset_embedding") {
    const state = await loadState();
    const next = updateVisualAssetEmbedding(state, args.assetId, args.model, args.embedding || []);
    await saveState(state);
    return next;
  }
  if (command === "visual_embedding_from_data_url") {
    return visualEmbeddingFromDataUrl(args.dataUrl || "");
  }
  if (command === "face_embedding_from_data_url") {
    return faceEmbeddingFromDataUrl(args.dataUrl || "");
  }
  throw new Error(`Comando local API non supportato: ${command}`);
}

async function resumeWatcherIfNeeded() {
  const state = await loadState().catch(() => null);
  if (!state?.watcherActive) return;
  await startFileWatcher(state.watchPaths || defaultWatchPaths()).catch(async (err) => {
    const next = await loadState();
    next.watcherError = String(err?.message || err);
    next.watcherActive = false;
    await saveState(next);
  });
}

async function resumeRemoteAccessIfNeeded() {
  const state = await loadState().catch(() => null);
  if (!state?.remoteAccess?.enabled) return;
  await startRemoteAccessServer(state.remoteAccess).catch(async (err) => {
    const next = await loadState();
    next.remoteAccess = normalizeRemoteAccessConfig({ ...(next.remoteAccess || {}), enabled: false });
    next.remoteAccess.lastError = String(err?.message || err);
    await saveState(next);
  });
}

function normalizeRemoteAccessConfig(config = {}) {
  const bind = ["127.0.0.1", "0.0.0.0"].includes(String(config.bind || "")) ? String(config.bind) : "127.0.0.1";
  const port = Math.max(1024, Math.min(65535, Number(config.port || 18754)));
  const token = String(config.token || "").trim() || randomBytes(24).toString("hex");
  return {
    enabled: Boolean(config.enabled),
    bind,
    port,
    token,
    allowFileDownload: config.allowFileDownload !== false,
    createdAt: config.createdAt || Date.now(),
    lastStartedAt: config.lastStartedAt || null,
    lastStoppedAt: config.lastStoppedAt || null,
    lastError: config.lastError || "",
  };
}

function remoteAccessStatus(state = {}, includeToken = false) {
  const config = normalizeRemoteAccessConfig(state.remoteAccess || {});
  return {
    enabled: Boolean(config.enabled),
    running: Boolean(activeRemoteAccessServer),
    bind: config.bind,
    port: config.port,
    url: `http://${config.bind === "0.0.0.0" ? "127.0.0.1" : config.bind}:${config.port}`,
    tokenPreview: config.token ? `${config.token.slice(0, 6)}...${config.token.slice(-4)}` : "",
    token: includeToken ? config.token : undefined,
    allowFileDownload: config.allowFileDownload,
    logPath: REMOTE_ACCESS_LOG,
    lastStartedAt: config.lastStartedAt,
    lastStoppedAt: config.lastStoppedAt,
    lastError: config.lastError || "",
  };
}

async function startRemoteAccessServer(configInput = {}) {
  const config = normalizeRemoteAccessConfig(configInput);
  if (activeRemoteAccessServer && activeRemoteAccessConfig?.port === config.port && activeRemoteAccessConfig?.bind === config.bind) {
    activeRemoteAccessConfig = { ...config, enabled: true, lastStartedAt: Date.now(), lastError: "" };
    return;
  }
  await stopRemoteAccessServer();
  activeRemoteAccessConfig = { ...config, enabled: true, lastStartedAt: Date.now(), lastError: "" };
  activeRemoteAccessServer = createServer((req, res) => {
    void handleRemoteAccessRequest(req, res, activeRemoteAccessConfig).catch((err) => {
      void logRemoteAccess(req, 500, String(err?.message || err));
      endJson(res, { ok: false, error: String(err?.message || err) }, 500);
    });
  });
  await new Promise((resolve, reject) => {
    activeRemoteAccessServer.once("error", reject);
    activeRemoteAccessServer.listen(config.port, config.bind, resolve);
  });
  await logRemoteAccess(null, 200, `server started ${config.bind}:${config.port}`);
}

async function stopRemoteAccessServer() {
  if (!activeRemoteAccessServer) return;
  const server = activeRemoteAccessServer;
  activeRemoteAccessServer = null;
  await new Promise((resolve) => server.close(resolve));
  await logRemoteAccess(null, 200, "server stopped");
}

async function handleRemoteAccessRequest(req, res, config) {
  setCors(res);
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, x-trova-token");
  if (req.method === "OPTIONS") return endJson(res, { ok: true });
  if (!remoteAccessAuthorized(req, config)) {
    await logRemoteAccess(req, 401, "unauthorized");
    return endJson(res, { ok: false, error: "Token remoto mancante o non valido." }, 401);
  }
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const state = await loadState();
  if (req.method === "GET" && url.pathname === "/api/health") {
    await logRemoteAccess(req, 200, "health");
    return endJson(res, {
      ok: true,
      result: {
        app: "Trova",
        index: indexStatus(state),
        remoteAccess: remoteAccessStatus(state),
      },
    });
  }
  if (req.method === "POST" && url.pathname === "/api/search") {
    const body = JSON.parse(await readBody(req) || "{}");
    const results = await searchIndex(state.index || [], {
      textQuery: body.query || body.textQuery || "",
      mode: body.mode || "text",
      filters: body.filters || ["all"],
      limit: body.limit || 30,
      semantic: body.semantic !== false,
      fuzzy: body.fuzzy !== false,
      useLocal: true,
      useGemini: false,
    });
    await logRemoteAccess(req, 200, `search ${String(body.query || body.textQuery || "").slice(0, 80)}`);
    return endJson(res, { ok: true, result: results.slice(0, Math.max(1, Math.min(100, Number(body.limit || 30)))) });
  }
  if (req.method === "POST" && url.pathname === "/api/ask") {
    const body = JSON.parse(await readBody(req) || "{}");
    const result = await askFiles(state.index || [], {
      question: body.question || body.query || "",
      filters: body.filters || ["all"],
      limit: body.limit || 6,
    });
    await logRemoteAccess(req, 200, `ask ${String(body.question || body.query || "").slice(0, 80)}`);
    return endJson(res, { ok: true, result });
  }
  if (req.method === "GET" && url.pathname === "/api/file") {
    if (!config.allowFileDownload) {
      await logRemoteAccess(req, 403, "download disabled");
      return endJson(res, { ok: false, error: "Download file remoto disattivato." }, 403);
    }
    const target = normalizeFilePath(url.searchParams.get("path") || "");
    const entry = (state.index || []).find((item) => normalizeFilePath(item.filePath) === target);
    if (!entry) {
      await logRemoteAccess(req, 404, "file not indexed");
      return endJson(res, { ok: false, error: "File non presente nell'indice remoto." }, 404);
    }
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > 120 * 1024 * 1024) {
      await logRemoteAccess(req, 413, "file too large");
      return endJson(res, { ok: false, error: "File troppo grande per download remoto." }, 413);
    }
    await logRemoteAccess(req, 200, `download ${entry.name}`);
    res.writeHead(200, {
      "content-type": mime(ext(target)),
      "content-length": stat.size,
      "content-disposition": `attachment; filename="${path.basename(target).replaceAll("\"", "")}"`,
    });
    return fs.readFile(target).then((bytes) => res.end(bytes));
  }
  await logRemoteAccess(req, 404, "not found");
  return endJson(res, { ok: false, error: "Endpoint remoto non trovato." }, 404);
}

function remoteAccessAuthorized(req, config) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const header = String(req.headers["x-trova-token"] || "").trim();
  const query = String(url.searchParams.get("token") || "").trim();
  return [bearer, header, query].some((value) => value && value === config.token);
}

async function logRemoteAccess(req, status, message) {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    status,
    method: req?.method || "SYSTEM",
    url: req?.url ? String(req.url).replace(/token=[^&]+/g, "token=redacted") : "",
    remote: req?.socket?.remoteAddress || "",
    message,
  });
  await fs.appendFile(REMOTE_ACCESS_LOG, `${line}\n`).catch(() => {});
}

async function rcloneStatus(state = {}) {
  const command = await rcloneCommand();
  const version = command ? await commandVersion(command.command, [...command.prefix, "version"]).catch(() => "installato") : "";
  const remotes = command ? await listRcloneRemotes(command).catch(() => []) : [];
  return {
    installed: Boolean(command),
    command: command ? [command.command, ...command.prefix].join(" ") : "",
    version,
    remotes,
    providers: RCLONE_PROVIDERS,
    connectors: state.connectors || [],
    cacheRoot: REMOTE_DIR,
  };
}

async function listRcloneRemotes(command = null) {
  const rclone = command || await rcloneCommand();
  if (!rclone) return [];
  const { stdout } = await execFile(rclone.command, [...rclone.prefix, "listremotes"], {
    timeout: 8000,
    maxBuffer: 400_000,
  });
  return stdout.split("\n").map((item) => item.trim().replace(/:$/, "")).filter(Boolean);
}

async function createRcloneRemote(request) {
  const provider = String(request.provider || "").trim();
  const remoteName = sanitizeRemoteName(request.remoteName || request.name);
  if (!provider || !remoteName) throw new Error("Specifica provider e nome remote rclone.");
  if (provider === "local") {
    throw new Error("Il provider local non richiede `rclone config create`: scegli una cartella e sincronizza.");
  }
  const command = await rcloneCommand();
  if (!command) throw new Error("Rclone non installato. Installa il componente Rclone oppure aggiungilo al PATH.");
  const config = Object.entries(request.config || {})
    .flatMap(([key, value]) => String(value ?? "").trim() ? [String(key), String(value)] : []);
  await execFile(command.command, [...command.prefix, "config", "create", remoteName, provider, ...config], {
    timeout: 120_000,
    maxBuffer: 1_000_000,
  });
  return { ok: true, remoteName, provider, remotes: await listRcloneRemotes(command).catch(() => []) };
}

function findConnector(state, id) {
  const connector = (state.connectors || []).find((item) => item.id === id);
  if (!connector) throw new Error("Connector remote non trovato.");
  return connector;
}

function normalizeConnectors(connectors) {
  return connectors.map((connector) => normalizeConnector(connector));
}

function normalizeConnector(connector = {}) {
  const provider = String(connector.provider || "local").toLowerCase();
  const id = connector.id || hash(`${connector.name || connector.remoteName || provider}:${connector.remotePath || connector.localPath || Date.now()}`).slice(0, 16);
  const cachePath = connector.cachePath || remoteCachePath({ ...connector, id });
  return {
    id,
    name: String(connector.name || connector.remoteName || connector.remotePath || "Remote Trova"),
    provider,
    sourceType: "remote",
    remoteName: String(connector.remoteName || ""),
    remotePath: String(connector.remotePath || connector.localPath || ""),
    cachePath,
    enabled: connector.enabled !== false,
    readOnly: connector.readOnly !== false,
    autoSync: connector.autoSync !== false,
    geminiEnabled: Boolean(connector.geminiEnabled),
    recursive: connector.recursive !== false,
    fileTypeFilter: normalizeFileTypeFilter(connector.fileTypeFilter),
    syncMode: connector.syncMode || "cache",
    lastSyncAt: connector.lastSyncAt || null,
    lastSyncStatus: connector.lastSyncStatus || "mai sincronizzato",
    lastSyncError: connector.lastSyncError || "",
    lastTestAt: connector.lastTestAt || null,
    lastTestOk: Boolean(connector.lastTestOk),
  };
}

function normalizeFileTypeFilter(filter) {
  if (!filter?.extensions?.length) return undefined;
  return {
    mode: filter.mode === "exclude" ? "exclude" : "include",
    extensions: Array.from(new Set(filter.extensions.map((item) => String(item).trim().toLowerCase()).filter(Boolean))),
  };
}

function upsertConnector(connectors, connector) {
  const normalized = normalizeConnector(connector);
  const exists = connectors.some((item) => item.id === normalized.id);
  return exists
    ? connectors.map((item) => item.id === normalized.id ? normalized : item)
    : [...connectors, normalized];
}

async function testRemoteConnector(connector) {
  const started = Date.now();
  const normalized = normalizeConnector(connector);
  try {
    if (normalized.provider === "local") {
      const stat = await fs.stat(normalized.remotePath);
      if (!stat.isDirectory()) throw new Error("Il percorso local remote non e una cartella.");
      const sample = await fs.readdir(normalized.remotePath).catch(() => []);
      return {
        ok: true,
        durationMs: Date.now() - started,
        message: `Cartella raggiungibile con ${sample.length} elementi visibili.`,
        sample: sample.slice(0, 20),
        connector: { ...normalized, lastTestAt: Date.now(), lastTestOk: true, lastSyncError: "" },
      };
    }
    const command = await rcloneCommand();
    if (!command) throw new Error("Rclone non installato.");
    const target = rcloneTarget(normalized);
    const { stdout } = await execFile(command.command, [...command.prefix, "lsjson", target, "--max-depth", "1"], {
      timeout: 45_000,
      maxBuffer: 1_000_000,
    });
    const sample = JSON.parse(stdout || "[]").slice(0, 20).map((item) => item.Path || item.Name).filter(Boolean);
    return {
      ok: true,
      durationMs: Date.now() - started,
      message: `${target} raggiungibile con rclone.`,
      sample,
      connector: { ...normalized, lastTestAt: Date.now(), lastTestOk: true, lastSyncError: "" },
    };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      message: String(err?.message || err),
      sample: [],
      connector: { ...normalized, lastTestAt: Date.now(), lastTestOk: false, lastSyncError: String(err?.message || err) },
    };
  }
}

async function syncRemoteConnector(connector) {
  const normalized = normalizeConnector(connector);
  if (!normalized.enabled) throw new Error("Connector disattivato.");
  if (!normalized.remotePath && normalized.provider === "local") throw new Error("Specifica la cartella sorgente del remote local.");
  await fs.rm(normalized.cachePath, { recursive: true, force: true });
  await fs.mkdir(normalized.cachePath, { recursive: true });
  const started = Date.now();
  let copied = 0;
  if (normalized.provider === "local") {
    await fs.cp(normalized.remotePath, normalized.cachePath, {
      recursive: true,
      force: true,
      filter: (source) => shouldCopyRemotePath(source),
    });
    copied = (await walk(normalized.cachePath, true)).length;
  } else {
    const command = await rcloneCommand();
    if (!command) throw new Error("Rclone non installato.");
    const args = [
      ...command.prefix,
      "sync",
      rcloneTarget(normalized),
      normalized.cachePath,
      "--create-empty-src-dirs",
      "--metadata",
      "--links",
      "--transfers",
      String(process.env.TROVA_RCLONE_TRANSFERS || 4),
      ...rcloneFilterArgs(normalized.fileTypeFilter),
    ];
    await execFile(command.command, args, {
      timeout: Number(process.env.TROVA_RCLONE_SYNC_TIMEOUT_MS || 900_000),
      maxBuffer: 4_000_000,
    });
    copied = (await walk(normalized.cachePath, true)).length;
  }
  const synced = {
    ...normalized,
    cachePath: normalized.cachePath,
    lastSyncAt: Date.now(),
    lastSyncStatus: `${copied} file in cache locale`,
    lastSyncError: "",
    lastTestOk: true,
  };
  return {
    ok: true,
    durationMs: Date.now() - started,
    filesSynced: copied,
    connector: synced,
    watchPath: remoteWatchPath(synced),
  };
}

async function syncAutoRemoteConnectors(state) {
  const connectors = normalizeConnectors(state.connectors || []);
  let watchPaths = state.watchPaths || defaultWatchPaths();
  const summary = { synced: 0, skipped: 0, errors: 0, results: [] };
  let nextConnectors = connectors;
  for (const connector of connectors) {
    if (!connector.enabled || !connector.autoSync) {
      summary.skipped += 1;
      continue;
    }
    try {
      const result = await syncRemoteConnector(connector);
      nextConnectors = upsertConnector(nextConnectors, result.connector);
      watchPaths = upsertRemoteWatchPath(watchPaths, result.connector);
      summary.synced += 1;
      summary.results.push({ id: connector.id, ok: true, filesSynced: result.filesSynced });
    } catch (err) {
      summary.errors += 1;
      const failed = { ...connector, lastSyncError: String(err?.message || err), lastSyncStatus: "sync non riuscita" };
      nextConnectors = upsertConnector(nextConnectors, failed);
      summary.results.push({ id: connector.id, ok: false, error: failed.lastSyncError });
    }
  }
  return { state: { ...state, connectors: nextConnectors, watchPaths: syncRemoteWatchPaths(watchPaths, nextConnectors) }, summary };
}

function syncRemoteWatchPaths(watchPaths, connectors) {
  let next = watchPaths.filter((item) => !(item.sourceType === "remote" && !connectors.some((connector) => connector.id === item.remoteId)));
  for (const connector of connectors.filter((item) => item.enabled)) {
    next = upsertRemoteWatchPath(next, connector);
  }
  return next;
}

function upsertRemoteWatchPath(watchPaths, connector) {
  const watch = remoteWatchPath(connector);
  const exists = watchPaths.some((item) => item.remoteId === connector.id || item.id === watch.id);
  return exists
    ? watchPaths.map((item) => item.remoteId === connector.id || item.id === watch.id ? { ...item, ...watch } : item)
    : [...watchPaths, watch];
}

function remoteWatchPath(connector) {
  return {
    id: `remote-${connector.id}`,
    path: connector.cachePath,
    enabled: connector.enabled !== false,
    recursive: connector.recursive !== false,
    isExcluded: false,
    geminiEnabled: Boolean(connector.geminiEnabled),
    autoIndex: true,
    sourceType: "remote",
    remoteId: connector.id,
    remotePath: connector.provider === "local" ? connector.remotePath : rcloneTarget(connector),
    syncMode: connector.syncMode || "cache",
    fileTypeFilter: connector.fileTypeFilter,
  };
}

function remoteCachePath(connector) {
  return path.join(REMOTE_DIR, safeSegment(connector.id || connector.name || "remote"), "files");
}

function safeSegment(value) {
  return String(value || "remote").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "remote";
}

function sanitizeRemoteName(value) {
  return safeSegment(value).replace(/[.-]+$/g, "") || "trova-remote";
}

function rcloneTarget(connector) {
  const remoteName = String(connector.remoteName || "").replace(/:$/, "");
  if (!remoteName) throw new Error("Specifica il nome remote rclone.");
  const remotePath = String(connector.remotePath || "").replace(/^\/+/, "");
  return `${remoteName}:${remotePath}`;
}

function rcloneFilterArgs(filter) {
  if (!filter?.extensions?.length) return [];
  const extensions = filter.extensions.map((item) => item.replace(/^\./, "").toLowerCase()).filter(Boolean);
  if (!extensions.length) return [];
  if (filter.mode === "exclude") {
    return extensions.flatMap((extension) => ["--exclude", `*.${extension}`, "--exclude", `**/*.${extension}`]);
  }
  return [
    ...extensions.flatMap((extension) => ["--include", `*.${extension}`, "--include", `**/*.${extension}`]),
    "--exclude",
    "*",
  ];
}

function shouldCopyRemotePath(source) {
  const name = path.basename(source);
  return !(
    name === ".git"
    || name === "node_modules"
    || name === "target"
    || source.includes(`${path.sep}.git${path.sep}`)
    || source.includes(`${path.sep}node_modules${path.sep}`)
    || source.includes(`${path.sep}target${path.sep}`)
  );
}

async function startFileWatcher(watchPaths) {
  await stopFileWatcher(false);
  const roots = watcherRoots(watchPaths);
  if (!roots.length) return;
  activeWatcher = chokidar.watch(roots, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 900, pollInterval: 120 },
    ignored: (targetPath) => shouldIgnoreWatcherPath(targetPath),
  });
  activeWatcher
    .on("add", (filePath) => enqueueWatcherEvent("add", filePath))
    .on("change", (filePath) => enqueueWatcherEvent("change", filePath))
    .on("unlink", (filePath) => enqueueWatcherEvent("unlink", filePath))
    .on("unlinkDir", (filePath) => enqueueWatcherEvent("unlink", filePath))
    .on("error", (error) => {
      void loadState().then(async (state) => {
        state.watcherError = String(error?.message || error);
        await saveState(state);
      });
    });
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000);
    activeWatcher.once("ready", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function stopFileWatcher(clearQueue = true) {
  if (watcherDebounceTimer) {
    clearTimeout(watcherDebounceTimer);
    watcherDebounceTimer = null;
  }
  if (clearQueue) watcherQueue.clear();
  const watcher = activeWatcher;
  activeWatcher = null;
  if (watcher) await watcher.close().catch(() => {});
}

function watcherRoots(watchPaths = []) {
  return Array.from(new Set(
    watchPaths
      .filter((item) => item.enabled && !item.isExcluded && item.autoIndex !== false)
      .map((item) => normalizeFilePath(item.path)),
  ));
}

function shouldIgnoreWatcherPath(targetPath) {
  const name = path.basename(targetPath);
  return name.startsWith(".")
    || targetPath.includes(`${path.sep}node_modules${path.sep}`)
    || targetPath.includes(`${path.sep}target${path.sep}`)
    || targetPath.includes(`${path.sep}.git${path.sep}`)
    || normalizeFilePath(targetPath) === normalizeFilePath(STATE_PATH)
    || isInsidePath(targetPath, PREVIEW_DIR)
    || isInsidePath(targetPath, KEYFRAME_DIR)
    || isInsidePath(targetPath, TRANSCRIPT_DIR)
    || isInsidePath(targetPath, OCR_DIR);
}

function enqueueWatcherEvent(event, filePath) {
  const normalized = normalizeFilePath(filePath);
  watcherQueue.set(normalized, { event, filePath: normalized, queuedAt: Date.now() });
  void loadState().then(async (state) => {
    state.lastWatcherEvent = { event, path: normalized, queuedAt: Date.now(), status: "queued" };
    state.watcherQueued = watcherQueue.size;
    await saveState(state);
  }).catch(() => {});
  if (watcherDebounceTimer) clearTimeout(watcherDebounceTimer);
  watcherDebounceTimer = setTimeout(() => {
    watcherDebounceTimer = null;
    void processWatcherQueue();
  }, WATCHER_DEBOUNCE_MS);
}

async function processWatcherQueue() {
  if (watcherBusy || !watcherQueue.size) return;
  watcherBusy = true;
  try {
    const state = await loadState();
    const watchPaths = state.watchPaths || defaultWatchPaths();
    const previousIndex = state.index || [];
    const previousByPath = new Map(previousIndex.map((entry) => [normalizeFilePath(entry.filePath), entry]));
    const previousAssets = new Map();
    for (const entry of previousIndex) {
      for (const asset of entry.visualAssets || []) previousAssets.set(visualAssetId(asset), asset);
    }
    const batch = Array.from(watcherQueue.values()).slice(0, WATCHER_BATCH_LIMIT);
    for (const item of batch) watcherQueue.delete(item.filePath);
    let changed = false;
    const nextIndex = previousIndex.filter((entry) => {
      const normalized = normalizeFilePath(entry.filePath);
      const removed = batch.some((item) => item.event === "unlink" && (normalized === item.filePath || isInsidePath(normalized, item.filePath)));
      if (removed) changed = true;
      return !removed;
    });

    for (const item of batch.filter((queued) => queued.event !== "unlink")) {
      const owner = ownerForFile(item.filePath, watchPaths);
      if (!owner) continue;
      if (shouldSkipFile(item.filePath, owner, watchPaths)) continue;
      const previous = previousByPath.get(item.filePath);
      const entry = await indexFileIfChanged(item.filePath, owner, previous, previousAssets).catch(() => null);
      if (!entry) continue;
      const index = nextIndex.findIndex((candidate) => normalizeFilePath(candidate.filePath) === item.filePath);
      if (index >= 0) nextIndex[index] = entry;
      else nextIndex.push(entry);
      changed = true;
    }

    state.index = nextIndex;
    state.watcherProcessed = (state.watcherProcessed || 0) + batch.length;
    state.watcherQueued = watcherQueue.size;
    state.lastWatcherEvent = {
      ...(batch[batch.length - 1] || {}),
      processedAt: Date.now(),
      status: changed ? "indexed" : "ignored",
    };
    state.lastIndexedAt = changed ? Date.now() : state.lastIndexedAt;
    await saveState(state);
    if (changed) await syncTypesenseIndex(nextIndex).catch((err) => rememberTypesenseError(err));
  } finally {
    watcherBusy = false;
    if (watcherQueue.size) void processWatcherQueue();
  }
}

function ownerForFile(filePath, watchPaths = []) {
  const normalized = normalizeFilePath(filePath);
  const candidates = watchPaths
    .filter((item) => item.enabled && !item.isExcluded && item.autoIndex !== false)
    .filter((item) => isInsidePath(normalized, item.path))
    .sort((a, b) => normalizeFilePath(b.path).length - normalizeFilePath(a.path).length);
  for (const candidate of candidates) {
    const root = normalizeFilePath(candidate.path);
    if (!candidate.recursive && path.dirname(normalized) !== root) continue;
    return candidate;
  }
  return null;
}

async function buildIndex(watchPaths, previousIndex = []) {
  const entries = [];
  const stats = { filesDiscovered: 0, filesIndexed: 0, filesSkipped: 0, unchanged: 0, errors: 0 };
  const previousByPath = new Map(previousIndex.map((entry) => [entry.filePath, entry]));
  const previousAssets = new Map();
  for (const entry of previousIndex) {
    for (const asset of entry.visualAssets || []) {
      previousAssets.set(visualAssetId(asset), asset);
    }
  }
  let discovered = 0;
  for (const watchPath of watchPaths.filter((item) => item.enabled && !item.isExcluded && item.autoIndex !== false)) {
    const root = watchPath.path;
    const files = await walk(root, watchPath.recursive);
    for (const filePath of files) {
      if (discovered++ > MAX_FILES) break;
      stats.filesDiscovered += 1;
      if (shouldSkipFile(filePath, watchPath, watchPaths)) {
        stats.filesSkipped += 1;
        continue;
      }
      const entry = await indexFileIfChanged(filePath, watchPath, previousByPath.get(filePath), previousAssets).catch(() => {
        stats.errors += 1;
        return null;
      });
      if (!entry) {
        stats.filesSkipped += 1;
        continue;
      }
      if (entry === previousByPath.get(filePath)) stats.unchanged += 1;
      else stats.filesIndexed += 1;
      entries.push(entry);
    }
  }
  return { index: entries, stats };
}

function shouldSkipFile(filePath, owner, allPaths) {
  const resolvedFile = normalizeFilePath(filePath);
  if (allPaths.some((item) => item.enabled && item.isExcluded && isInsidePath(resolvedFile, item.path))) return true;
  const filter = owner.fileTypeFilter;
  if (!filter?.extensions?.length) return false;
  const extension = ext(filePath);
  const configured = new Set(filter.extensions.map((item) => item.replace(/^\./, "").toLowerCase()).filter(Boolean));
  if (filter.mode === "include") return !configured.has(extension);
  if (filter.mode === "exclude") return configured.has(extension);
  return false;
}

async function walk(root, recursive = true) {
  const out = [];
  const queue = [root];
  while (queue.length && out.length < MAX_FILES) {
    const current = queue.shift();
    let items = [];
    try {
      items = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const item of items) {
      if (item.name.startsWith(".") || item.name === "node_modules" || item.name === "target") continue;
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        if (recursive) queue.push(full);
      } else if (item.isFile()) {
        out.push(full);
      }
    }
  }
  return out;
}

async function indexFileIfChanged(filePath, watchPath, previousEntry, previousAssets) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
  const fileHash = fileFingerprint(filePath, stat);
  if (previousEntry?.fileHash === fileHash && hasSemanticChunks(previousEntry) && previousEntry.visualIndexVersion === VISUAL_INDEX_VERSION) {
    return withCurrentWatchPathMetadata(previousEntry, watchPath);
  }
  return indexFile(filePath, watchPath, previousAssets, stat, fileHash);
}

function withCurrentWatchPathMetadata(entry, watchPath) {
  return {
    ...entry,
    sourceWatchPath: watchPath.path,
    sourceType: watchPath.sourceType || "local",
    remoteId: watchPath.remoteId,
    remotePath: watchPath.remotePath,
    syncMode: watchPath.syncMode,
    geminiEnabled: Boolean(watchPath.geminiEnabled),
  };
}

async function indexFile(filePath, watchPath, previousAssets, knownStat, knownHash) {
  const stat = knownStat || await fs.stat(filePath);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
  const extension = ext(filePath);
  const kind = classify(extension);
  const name = path.basename(filePath);
  const content = await extractText(filePath, extension, stat.size, kind);
  const visualAssets = await visualAssetsFor(filePath, kind, extension, previousAssets);
  const searchableContent = content || metadataText(filePath, kind, extension, stat);
  const textChunks = await semanticChunksForFile(filePath, searchableContent, kind);
  return {
    id: filePath,
    filePath,
    path: filePath,
    name,
    kind,
    extension,
    size: stat.size,
    modified: Math.floor(stat.mtimeMs / 1000),
    fileHash: knownHash || fileFingerprint(filePath, stat),
    content: searchableContent,
    chunks: textChunks.map((chunk) => chunk.text),
    textChunks,
    visualAssets,
    visualIndexVersion: VISUAL_INDEX_VERSION,
    sourceWatchPath: watchPath.path,
    sourceType: watchPath.sourceType || "local",
    remoteId: watchPath.remoteId,
    remotePath: watchPath.remotePath,
    syncMode: watchPath.syncMode,
    geminiEnabled: Boolean(watchPath.geminiEnabled),
  };
}

async function extractText(filePath, extension, size, kind) {
  if (size > 8 * 1024 * 1024 && !["pdf", "docx"].includes(extension) && !["audio", "video", "image"].includes(kind)) return "";
  if (["txt", "md", "csv", ...CODE_EXT].includes(extension)) {
    return (await fs.readFile(filePath, "utf8")).slice(0, MAX_TEXT_BYTES);
  }
  if (kind === "image") {
    const ocr = await ocrImage(filePath).catch(() => "");
    return ocr.slice(0, MAX_TEXT_BYTES);
  }
  if (["pdf", "docx", "pptx", "xlsx", "rtf", "odt"].includes(extension)) {
    const tika = await extractWithTika(filePath, extension).catch(() => "");
    if (extension === "pdf" && shouldOcrPdf(tika, size)) {
      const ocr = await ocrPdf(filePath).catch(() => "");
      return [tika, ocr].filter((part) => part?.trim()).join("\n").slice(0, MAX_TEXT_BYTES);
    }
    return tika.slice(0, MAX_TEXT_BYTES);
  }
  if (kind === "audio" || kind === "video") {
    const [metadata, sidecar] = await Promise.all([
      mediaMetadataText(filePath).catch(() => ""),
      sidecarTranscript(filePath).catch(() => ""),
    ]);
    const transcript = sidecar.trim().length > 24
      ? ""
      : await transcribeMedia(filePath, kind).catch(() => "");
    return [metadata, sidecar, transcript].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  }
  return "";
}

function metadataText(filePath, kind, extension, stat) {
  const name = path.basename(filePath);
  const parent = path.basename(path.dirname(filePath));
  return [
    name,
    parent,
    filePath,
    `tipo ${kind}`,
    `estensione ${extension}`,
    `dimensione ${stat.size} byte`,
  ].join(" ");
}

function hasSemanticChunks(entry) {
  return (entry.textChunks || []).some((chunk) =>
    Array.isArray(chunk.embedding)
    && chunk.embedding.length === TEXT_EMBEDDING_DIM
    && [TEXT_EMBEDDING_MODEL, LEXICAL_EMBEDDING_MODEL].includes(chunk.embeddingModel),
  );
}

async function semanticChunksForFile(filePath, content, kind) {
  const chunks = splitTextIntoChunks(content, MAX_TEXT_CHUNKS_PER_FILE);
  const out = [];
  for (const [chunkIndex, text] of chunks.entries()) {
    const embedded = await embedTextLocal(text);
    out.push({
      chunkId: hash(`${filePath}:${chunkIndex}:${hash(text).slice(0, 12)}`).slice(0, 24),
      filePath,
      chunkIndex,
      kind,
      text,
      textHash: hash(text).slice(0, 24),
      embedding: embedded.vector,
      embeddingModel: embedded.model,
      embeddingReady: embedded.ready,
    });
  }
  return out;
}

function splitTextIntoChunks(content, maxChunks = MAX_TEXT_CHUNKS_PER_FILE) {
  const normalized = String(content || "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const target = Number(process.env.TROVA_TEXT_CHUNK_CHARS || 1400);
  const overlap = 220;
  const chunks = [];
  let start = 0;
  while (start < normalized.length && chunks.length < maxChunks) {
    let end = Math.min(normalized.length, start + target);
    if (end < normalized.length) {
      const sentenceEnd = Math.max(
        normalized.lastIndexOf(". ", end),
        normalized.lastIndexOf("? ", end),
        normalized.lastIndexOf("! ", end),
        normalized.lastIndexOf("; ", end),
      );
      if (sentenceEnd > start + Math.floor(target * 0.45)) end = sentenceEnd + 1;
    }
    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

async function embedTextLocal(text) {
  try {
    const embedder = await getTextEmbedder();
    const vector = await embedder(String(text || "").slice(0, 4000));
    textEmbeddingStatus = { model: TEXT_EMBEDDING_MODEL, ready: true, fallback: false, error: "" };
    return { vector, model: TEXT_EMBEDDING_MODEL, ready: true };
  } catch (err) {
    const message = String(err?.message || err);
    textEmbeddingStatus = { model: LEXICAL_EMBEDDING_MODEL, ready: true, fallback: true, error: message };
    return { vector: lexicalEmbedding(text), model: LEXICAL_EMBEDDING_MODEL, ready: true };
  }
}

async function getTextEmbedder() {
  if (!textEmbedderPromise) textEmbedderPromise = loadTextEmbedder();
  return textEmbedderPromise;
}

async function loadTextEmbedder() {
  if (process.env.TROVA_DISABLE_TRANSFORMERS === "1") {
    throw new Error("Transformers disattivato per questo avvio.");
  }
  const { env, pipeline } = await import("@huggingface/transformers");
  env.allowRemoteModels = true;
  env.allowLocalModels = true;
  env.cacheDir = MODEL_DIR;
  const extractor = await pipeline("feature-extraction", TEXT_EMBEDDING_MODEL, { dtype: "q8" });
  return async (text) => {
    const tensor = await extractor(text, { pooling: "mean", normalize: true });
    return normalizeVector(Array.from(tensor.data || []));
  };
}

function lexicalEmbedding(text) {
  const vector = new Array(TEXT_EMBEDDING_DIM).fill(0);
  const tokens = tokenizeSearchText(text);
  for (const token of tokens) {
    const grams = token.length > 3 ? Array.from(trigrams(token)) : [token];
    for (const gram of grams) {
      const index = Number.parseInt(hash(gram).slice(0, 8), 16) % TEXT_EMBEDDING_DIM;
      vector[index] += 1;
    }
  }
  return normalizeVector(vector);
}

function normalizeVector(values) {
  const norm = Math.sqrt(values.reduce((total, value) => total + value * value, 0));
  return norm ? values.map((value) => value / norm) : values;
}

async function visualAssetsFor(filePath, kind, extension, previousAssets) {
  const assets = [];
  if (kind === "image") {
    const asset = await visualAssetWithFingerprint({ filePath, assetKind: "image", thumbnailPath: filePath });
    assets.push(mergePreviousAsset(asset, previousAssets));
  }
  if (extension === "pdf") {
    const previews = await renderPdfPreviews(filePath).catch(() => []);
    for (const preview of previews) {
      const asset = await visualAssetWithFingerprint({
        filePath,
        assetKind: "pdf-page",
        pageNumber: preview.pageNumber,
        thumbnailPath: preview.thumbnailPath,
      });
      assets.push(mergePreviousAsset(asset, previousAssets));
    }
  }
  if (kind === "video") {
    const keyframes = await renderVideoKeyframes(filePath).catch(() => []);
    for (const [index, keyframe] of keyframes.entries()) {
      const asset = await visualAssetWithFingerprint({
        filePath,
        assetKind: "video-keyframe",
        pageNumber: index + 1,
        thumbnailPath: keyframe.thumbnailPath,
        timestamp: keyframe.timestamp,
      });
      assets.push(mergePreviousAsset(asset, previousAssets));
    }
  }
  return assets;
}

async function visualAssetWithFingerprint(asset) {
  const imagePath = asset.thumbnailPath || asset.filePath;
  const [embedding, faceEmbedding] = await Promise.all([
    visualFingerprintForImagePath(imagePath).catch(() => []),
    faceEmbeddingForImagePath(imagePath).catch(() => []),
  ]);
  return {
    ...asset,
    embedding,
    embeddingModel: embedding.length ? VISUAL_FINGERPRINT_MODEL : undefined,
    faceEmbedding,
    faceEmbeddingModel: faceEmbedding.length ? FACE_FINGERPRINT_MODEL : undefined,
    visualEmbeddings: embedding.length ? [{ model: VISUAL_FINGERPRINT_MODEL, vector: embedding }] : [],
  };
}

function mergePreviousAsset(asset, previousAssets) {
  const previous = previousAssets.get(visualAssetId(asset));
  if (!previous) return asset;
  const previousModels = new Set(visualEmbeddingModels(previous));
  const nextEmbeddings = asset.visualEmbeddings || [];
  for (const item of previous.visualEmbeddings || []) {
    if (!nextEmbeddings.some((next) => next.model === item.model)) nextEmbeddings.push(item);
  }
  const embedding = asset.embedding?.length
    ? asset.embedding
    : previous.embedding || [];
  const embeddingModel = asset.embeddingModel || previous.embeddingModel;
  return {
    ...asset,
    embedding,
    embeddingModel,
    visualEmbeddings: previousModels.has(VISUAL_FINGERPRINT_MODEL) ? nextEmbeddings : nextEmbeddings,
    faceEmbedding: asset.faceEmbedding?.length ? asset.faceEmbedding : previous.faceEmbedding,
    faceEmbeddingModel: asset.faceEmbeddingModel || previous.faceEmbeddingModel,
  };
}

async function renderPdfPreviews(filePath) {
  const maxPages = Math.max(1, Math.min(24, Number(process.env.TROVA_PDF_PREVIEW_PAGES || 6)));
  const safe = hash(`${filePath}:${await fileMtimeSignature(filePath)}:pdf-preview:${maxPages}`).slice(0, 24);
  const base = path.join(PREVIEW_DIR, `${safe}-page`);
  const existing = await renderedPreviewFiles(safe);
  if (existing.length) return existing;
  const poppler = await commandCandidate("pdftoppm", ["-v"]);
  if (!poppler) return [];
  await execFile(poppler.command, [
    ...poppler.prefix,
    "-f",
    "1",
    "-l",
    String(maxPages),
    "-png",
    "-scale-to",
    "720",
    filePath,
    base,
  ], { timeout: 60_000, maxBuffer: 200_000 });
  return renderedPreviewFiles(safe);
}

async function renderedPreviewFiles(safe) {
  const files = (await fs.readdir(PREVIEW_DIR).catch(() => []))
    .filter((name) => name.startsWith(`${safe}-page`) && name.endsWith(".png"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return files.map((name, index) => ({
    thumbnailPath: path.join(PREVIEW_DIR, name),
    pageNumber: pageNumberFromRenderedName(name) || index + 1,
  }));
}

function pageNumberFromRenderedName(name) {
  const match = name.match(/-(\d+)\.png$/);
  return match ? Number(match[1]) : 0;
}

async function renderVideoKeyframes(filePath) {
  const frames = [];
  const safe = hash(filePath).slice(0, 24);
  const times = await videoKeyframeTimes(filePath);
  const ffmpeg = await mediaCommand("ffmpeg");
  if (!ffmpeg) return frames;
  for (const seconds of times) {
    const out = path.join(KEYFRAME_DIR, `${safe}-${seconds}.jpg`);
    try {
      await fs.access(out);
      frames.push({ thumbnailPath: out, timestamp: seconds });
      continue;
    } catch {
      // render it below
    }
    try {
      await execFile(ffmpeg.command, [
        ...ffmpeg.prefix,
        "-y",
        "-ss",
        String(seconds),
        "-i",
        filePath,
        "-frames:v",
        "1",
        "-vf",
        "scale=720:-2",
        "-q:v",
        "3",
        "-update",
        "1",
        out,
      ], { timeout: 30_000 });
    } catch {
      continue;
    }
    try {
      await fs.access(out);
      frames.push({ thumbnailPath: out, timestamp: seconds });
    } catch {
      // Some short clips do not have a frame at later timestamps.
    }
  }
  return frames;
}

async function videoKeyframeTimes(filePath) {
  const interval = Math.max(1, Number(process.env.TROVA_VIDEO_KEYFRAME_SECONDS || 5));
  const maxFrames = Math.max(1, Math.min(120, Number(process.env.TROVA_VIDEO_KEYFRAME_MAX || 24)));
  const duration = await mediaDurationSeconds(filePath).catch(() => 0);
  if (!duration) return [0.5, 2, 8, 20].slice(0, maxFrames);
  const times = [Math.min(0.5, Math.max(0, duration / 2))];
  for (let second = interval; second < duration && times.length < maxFrames; second += interval) {
    times.push(Number(second.toFixed(2)));
  }
  return Array.from(new Set(times.map((second) => Math.min(Math.max(0, second), Math.max(0, duration - 0.1))))).slice(0, maxFrames);
}

async function mediaMetadataText(filePath) {
  const ffprobe = await mediaCommand("ffprobe");
  if (!ffprobe) return "";
  const { stdout } = await execFile(ffprobe.command, [
    ...ffprobe.prefix,
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ], { timeout: 20_000, maxBuffer: 2_000_000 });
  const data = JSON.parse(stdout || "{}");
  const format = data.format || {};
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const tags = format.tags || {};
  const parts = [
    path.basename(filePath),
    format.format_long_name,
    format.duration ? `durata ${Math.round(Number(format.duration))} secondi` : "",
    format.bit_rate ? `bitrate ${format.bit_rate}` : "",
    tags.title,
    tags.artist,
    tags.album,
    tags.comment,
    ...streams.flatMap((stream) => [
      stream.codec_type,
      stream.codec_name,
      stream.width && stream.height ? `${stream.width}x${stream.height}` : "",
      stream.sample_rate ? `${stream.sample_rate}Hz` : "",
      stream.channels ? `${stream.channels} canali` : "",
    ]),
  ];
  return parts.filter(Boolean).join(" ");
}

async function sidecarTranscript(filePath) {
  const parsed = path.parse(filePath);
  const candidates = [".txt", ".srt", ".vtt"].map((suffix) => path.join(parsed.dir, `${parsed.name}${suffix}`));
  const texts = [];
  for (const candidate of candidates) {
    try {
      texts.push(await fs.readFile(candidate, "utf8"));
    } catch {
      // no sidecar
    }
  }
  return texts.join("\n");
}

async function extractWithTika(filePath, extension) {
  const bytes = await fs.readFile(filePath);
  const response = await fetch("http://127.0.0.1:9998/tika", {
    method: "PUT",
    headers: {
      Accept: "text/plain",
      "Content-Type": mime(extension),
    },
    body: bytes,
  });
  if (!response.ok) return "";
  return response.text();
}

function shouldOcrPdf(tikaText, size) {
  if (size > 45 * 1024 * 1024) return false;
  const words = String(tikaText || "").trim().split(/\s+/).filter(Boolean);
  return words.length < 18;
}

async function ocrImage(filePath) {
  const stat = await fs.stat(filePath);
  if (stat.size > 35 * 1024 * 1024) return "";
  const command = await commandCandidate("tesseract", ["--version"]);
  if (!command) return "";
  const { stdout } = await execFile(command.command, [
    ...command.prefix,
    filePath,
    "stdout",
    "-l",
    "ita+eng",
  ], { timeout: 90_000, maxBuffer: MAX_TEXT_BYTES });
  return stdout ? `OCR immagine:\n${stdout}` : "";
}

async function ocrPdf(filePath) {
  const command = await commandCandidate("tesseract", ["--version"]);
  const poppler = await commandCandidate("pdftoppm", ["-v"]);
  if (!command || !poppler) return "";
  const safe = hash(`${filePath}:ocr:${await fileMtimeSignature(filePath)}`).slice(0, 24);
  const cached = path.join(OCR_DIR, `${safe}.txt`);
  try {
    return await fs.readFile(cached, "utf8");
  } catch {
    // render and OCR below
  }
  const base = path.join(OCR_DIR, `${safe}-page`);
  await execFile(poppler.command, [
    ...poppler.prefix,
    "-f",
    "1",
    "-l",
    "4",
    "-png",
    "-scale-to",
    "1600",
    filePath,
    base,
  ], { timeout: 60_000, maxBuffer: 200_000 });
  const rendered = (await fs.readdir(OCR_DIR))
    .filter((name) => name.startsWith(`${safe}-page`) && name.endsWith(".png"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => path.join(OCR_DIR, name));
  const pages = [];
  for (const [index, imagePath] of rendered.entries()) {
    const text = await ocrImage(imagePath).catch(() => "");
    if (text.trim()) pages.push(`OCR PDF pagina ${index + 1}:\n${text.replace(/^OCR immagine:\n?/, "")}`);
  }
  const out = pages.join("\n\n").slice(0, MAX_TEXT_BYTES);
  if (out) await fs.writeFile(cached, out);
  return out;
}

async function transcribeMedia(filePath, kind) {
  const stat = await fs.stat(filePath);
  if (stat.size > Number(process.env.TROVA_WHISPER_MAX_BYTES || 180 * 1024 * 1024)) {
    return `Whisper locale saltato: file ${kind} troppo grande per la trascrizione automatica.`;
  }
  const duration = await mediaDurationSeconds(filePath).catch(() => 0);
  const maxDuration = Number(process.env.TROVA_WHISPER_MAX_SECONDS || 1800);
  if (duration && duration > maxDuration) {
    return `Whisper locale saltato: durata ${Math.round(duration)} secondi oltre il limite ${maxDuration}.`;
  }
  const command = await whisperCommand();
  if (!command) return "";
  const model = process.env.TROVA_WHISPER_MODEL || "base";
  const safe = hash(`${filePath}:${stat.size}:${stat.mtimeMs}:whisper:${model}`).slice(0, 24);
  const cached = path.join(TRANSCRIPT_DIR, `${safe}.txt`);
  try {
    return await fs.readFile(cached, "utf8");
  } catch {
    // transcribe below
  }
  const outDir = path.join(TRANSCRIPT_DIR, safe);
  await fs.mkdir(outDir, { recursive: true });
  const languageArgs = (process.env.TROVA_WHISPER_LANGUAGE || "Italian").trim()
    ? ["--language", process.env.TROVA_WHISPER_LANGUAGE || "Italian"]
    : [];
  await execFile(command.command, [
    ...command.prefix,
    filePath,
    "--model",
    model,
    ...languageArgs,
    "--output_dir",
    outDir,
    "--output_format",
    "txt",
    "--verbose",
    "False",
  ], { timeout: Number(process.env.TROVA_WHISPER_TIMEOUT_MS || 900_000), maxBuffer: 2_000_000 });
  const outputName = `${path.parse(filePath).name}.txt`;
  const transcriptPath = path.join(outDir, outputName);
  const transcript = await fs.readFile(transcriptPath, "utf8").catch(async () => {
    const files = (await fs.readdir(outDir).catch(() => [])).filter((name) => name.endsWith(".txt"));
    return files[0] ? fs.readFile(path.join(outDir, files[0]), "utf8") : "";
  });
  const content = transcript.trim() ? `Trascrizione Whisper locale:\n${transcript.trim()}` : "";
  if (content) await fs.writeFile(cached, content);
  return content;
}

async function whisperCommand() {
  for (const binary of ["whisper", "whisper-cli", "whisper.cpp"]) {
    const command = await commandCandidate(binary, ["--help"]);
    if (command) return command;
  }
  return null;
}

async function mediaDurationSeconds(filePath) {
  const ffprobe = await mediaCommand("ffprobe");
  if (!ffprobe) return 0;
  const { stdout } = await execFile(ffprobe.command, [
    ...ffprobe.prefix,
    "-v",
    "quiet",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ], { timeout: 20_000, maxBuffer: 120_000 });
  const value = Number(String(stdout || "").trim());
  return Number.isFinite(value) ? value : 0;
}

async function visualEmbeddingFromDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return [];
  const mimeType = match[1].toLowerCase();
  const extension = mimeToImageExtension(mimeType);
  if (!extension) return [];
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) return [];
  const filePath = path.join(QUERY_DIR, `${hash(match[2]).slice(0, 24)}.${extension}`);
  await fs.writeFile(filePath, bytes);
  return visualFingerprintForImagePath(filePath);
}

async function faceEmbeddingFromDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return [];
  const mimeType = match[1].toLowerCase();
  const extension = mimeToImageExtension(mimeType);
  if (!extension) return [];
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) return [];
  const filePath = path.join(QUERY_DIR, `${hash(`${match[2]}:face`).slice(0, 24)}.${extension}`);
  await fs.writeFile(filePath, bytes);
  return faceEmbeddingForImagePath(filePath);
}

async function visualFingerprintForImagePath(imagePath) {
  return imageFingerprintForImagePath(imagePath, "scale=8:8:flags=area,format=rgb24");
}

async function faceEmbeddingForImagePath(imagePath) {
  return imageFingerprintForImagePath(imagePath, "crop=iw*0.62:ih*0.62:iw*0.19:ih*0.12,scale=8:8:flags=area,format=rgb24");
}

async function imageFingerprintForImagePath(imagePath, videoFilter) {
  const ffmpeg = await mediaCommand("ffmpeg");
  if (!ffmpeg) return [];
  const { stdout } = await execFile(ffmpeg.command, [
    ...ffmpeg.prefix,
    "-v",
    "error",
    "-i",
    imagePath,
    "-vf",
    videoFilter,
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "pipe:1",
  ], { timeout: 20_000, maxBuffer: 80_000, encoding: "buffer" });
  if (!Buffer.isBuffer(stdout) || stdout.length < 8 * 8 * 3) return [];
  const vector = [];
  const totals = [0, 0, 0];
  for (let index = 0; index < 8 * 8 * 3; index += 3) {
    const r = stdout[index] / 255;
    const g = stdout[index + 1] / 255;
    const b = stdout[index + 2] / 255;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const darkness = 1 - ((r + g + b) / 3);
    const weight = 0.18 + (chroma * 2.7) + (darkness * 0.35);
    vector.push(r * weight, g * weight, b * weight);
    totals[0] += r * weight;
    totals[1] += g * weight;
    totals[2] += b * weight;
  }
  vector.push(totals[0] / 64, totals[1] / 64, totals[2] / 64);
  return normalizeVector(vector);
}

function mimeToImageExtension(mimeType) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/bmp") return "bmp";
  if (mimeType === "image/gif") return "gif";
  return "";
}

async function searchIndex(index, request) {
  const query = String(request.textQuery || "").trim().toLowerCase();
  const filters = request.filters || ["all"];
  const imageQueries = [
    ...(Array.isArray(request.imageQueries) ? request.imageQueries : []),
    ...(Array.isArray(request.imageQuery) && request.imageQuery.length ? [request.imageQuery] : []),
  ].filter((embedding) => Array.isArray(embedding) && embedding.length);
  const faceQueries = [
    ...(Array.isArray(request.faceQueries) ? request.faceQueries : []),
    ...(Array.isArray(request.faceQuery) && request.faceQuery.length ? [request.faceQuery] : []),
  ].filter((embedding) => Array.isArray(embedding) && embedding.length);
  const visualThreshold = request.mode === "person"
    ? 0.52
    : request.mode === "text" && query ? 0.24 : 0.35;
  const semanticThreshold = request.semantic === false ? 2 : Number(process.env.TROVA_SEMANTIC_SEARCH_THRESHOLD || 0.24);
  const queryEmbedding = query && request.semantic !== false ? await embedTextLocal(query).catch(() => null) : null;
  const typesenseMatches = query ? await searchTypesense(query, filters).catch((err) => {
    rememberTypesenseError(err);
    return new Map();
  }) : new Map();
  const results = [];
  for (const entry of index) {
    if (!matchesFilter(entry.kind, filters)) continue;
    const haystack = `${entry.name} ${entry.filePath} ${entry.extension} ${entry.content}`.toLowerCase();
    const textScore = query ? scoreMatch(haystack, query, entry.name, entry.content, entry.kind) : 0;
    const typesenseScore = typesenseMatches.get(entry.filePath)?.score || 0;
    const semanticMatch = queryEmbedding ? bestSemanticChunk(entry, queryEmbedding.vector) : null;
    const semanticScore = semanticMatch && semanticMatch.score >= semanticThreshold
      ? Math.round(semanticMatch.score * 130)
      : 0;
    const personScore = request.mode === "person" && faceQueries.length
      ? bestFaceScore(entry.visualAssets || [], faceQueries)
      : 0;
    const visualScore = request.mode === "person"
      ? Math.max(personScore, imageQueries.length ? bestVisualScore(entry.visualAssets || [], imageQueries) * 0.82 : 0)
      : imageQueries.length ? bestVisualScore(entry.visualAssets || [], imageQueries) : 0;
    let score = textScore + typesenseScore + semanticScore;
    if (visualScore > visualThreshold) score += Math.round(visualScore * 140);
    if (!query && !imageQueries.length) score = 1;
    if (score <= 0) continue;
    const assetMatch = request.mode === "person" && faceQueries.length
      ? bestFaceAsset(entry.visualAssets || [], faceQueries) || bestVisualAsset(entry.visualAssets || [], imageQueries)
      : bestVisualAsset(entry.visualAssets || [], imageQueries);
    const rankBreakdown = {
      text: textScore,
      typesense: typesenseScore,
      semantic: semanticScore,
      visual: Math.round(visualScore * 140),
      person: Math.round(personScore * 140),
    };
    results.push({
      id: entry.filePath,
      name: entry.name,
      path: entry.filePath,
      kind: entry.kind,
      extension: entry.extension,
      size: entry.size,
      modified: entry.modified,
      snippet: textScore === 0 && visualScore > visualThreshold
        ? visualMatchSnippet(query, entry.kind, visualScore, request.mode)
        : makeSnippet(semanticScore > textScore ? semanticMatch?.chunk?.text || entry.content : entry.content, query, entry.kind),
      score,
      source: "local",
      sourceType: entry.sourceType || "local",
      remoteId: entry.remoteId,
      remotePath: entry.remotePath,
      syncMode: entry.syncMode,
      visual_preview: assetMatch?.thumbnailPath || entry.visualAssets?.[0]?.thumbnailPath,
      page_hint: assetMatch?.pageNumber || entry.visualAssets?.[0]?.pageNumber,
      pageNumber: assetMatch?.pageNumber || entry.visualAssets?.[0]?.pageNumber,
      timestamp: assetMatch?.timestamp,
      matchType: visualScore > visualThreshold ? request.mode === "person" ? "person" : "visual" : semanticScore > textScore ? "semantic" : typesenseScore > 0 && textScore === 0 ? "fuzzy" : "text",
      citations: semanticMatch?.chunk ? [chunkCitation(entry, semanticMatch.chunk, semanticMatch.score)] : [],
      assetId: assetMatch ? visualAssetId(assetMatch) : undefined,
      previewKind: assetMatch?.assetKind || entry.visualAssets?.[0]?.assetKind,
      rankBreakdown,
    });
  }
  const limit = Math.max(1, Math.min(250, Number(request.limit || 250)));
  return dedupeResults(results).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}

function bestSemanticChunk(entry, queryVector) {
  let best = null;
  for (const chunk of entryTextChunks(entry)) {
    if (!Array.isArray(chunk.embedding) || chunk.embedding.length !== queryVector.length) continue;
    const score = vectorSimilarity(queryVector, chunk.embedding);
    if (!best || score > best.score) best = { chunk, score };
  }
  return best;
}

async function findSimilarFiles(index, request) {
  const filters = request.filters || ["all"];
  const limit = Math.max(1, Math.min(250, Number(request.limit || 80)));
  let queryVector = null;
  let sourcePath = "";
  let queryText = String(request.textQuery || request.query || "").trim();

  if (request.filePath) {
    const source = index.find((entry) => entry.filePath === request.filePath || entry.path === request.filePath || entry.id === request.filePath);
    if (!source) throw new Error("File sorgente non trovato nell'indice locale.");
    queryVector = documentEmbedding(source);
    sourcePath = source.filePath;
    queryText = source.name;
  } else if (queryText) {
    queryVector = (await embedTextLocal(queryText)).vector;
  }
  if (!queryVector?.length) throw new Error("Serve un file indicizzato o una query testuale per trovare simili.");

  const results = [];
  for (const entry of index) {
    if (entry.filePath === sourcePath || !matchesFilter(entry.kind, filters)) continue;
    const semanticMatch = bestSemanticChunk(entry, queryVector);
    if (!semanticMatch || semanticMatch.score < Number(process.env.TROVA_SIMILARITY_THRESHOLD || 0.2)) continue;
    results.push(resultFromEntry(entry, {
      score: Math.round(semanticMatch.score * 160),
      snippet: makeSnippet(semanticMatch.chunk.text, queryText, entry.kind),
      matchType: "semantic",
      citations: [chunkCitation(entry, semanticMatch.chunk, semanticMatch.score)],
    }));
  }
  return results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}

async function askFiles(index, request) {
  const question = String(request.question || request.textQuery || request.query || "").trim();
  if (!question) throw new Error("Scrivi una domanda per interrogare i file locali.");
  const limit = Math.max(2, Math.min(12, Number(request.limit || 6)));
  const chunks = await retrieveTextChunks(index, question, request.filters || ["all"], limit);
  const citations = chunks.map((item) => chunkCitation(item.entry, item.chunk, item.score));
  const answer = buildExtractiveAnswer(question, chunks, citations);
  return {
    answer,
    citations,
    chunks: chunks.map((item) => ({
      filePath: item.entry.filePath,
      fileName: item.entry.name,
      chunkIndex: item.chunk.chunkIndex,
      snippet: compactSnippet(item.chunk.text, question, 420),
      score: item.score,
    })),
    model: textEmbeddingStatus.fallback ? LEXICAL_EMBEDDING_MODEL : TEXT_EMBEDDING_MODEL,
    source: "local",
  };
}

function getFileContext(index, request) {
  const target = String(request.filePath || request.path || request.id || "").trim();
  if (!target) throw new Error("Specifica filePath, path o id.");
  const entry = findIndexEntry(index, target);
  if (!entry) throw new Error("File non trovato nell'indice locale.");
  const maxChars = Math.max(200, Math.min(20_000, Number(request.maxChars || 5000)));
  return {
    id: entry.id,
    filePath: entry.filePath,
    name: entry.name,
    kind: entry.kind,
    extension: entry.extension,
    size: entry.size,
    modified: entry.modified,
    sourceWatchPath: entry.sourceWatchPath,
    sourceType: entry.sourceType || "local",
    remoteId: entry.remoteId,
    remotePath: entry.remotePath,
    syncMode: entry.syncMode,
    geminiEnabled: Boolean(entry.geminiEnabled),
    contentPreview: String(entry.content || "").slice(0, maxChars),
    chunks: entryTextChunks(entry).slice(0, Number(request.maxChunks || 8)).map((chunk) => ({
      chunkIndex: chunk.chunkIndex,
      text: String(chunk.text || "").slice(0, maxChars),
      embeddingModel: chunk.embeddingModel,
      embeddingReady: Boolean(chunk.embeddingReady),
    })),
    visualAssets: (entry.visualAssets || []).map((asset) => ({
      assetId: visualAssetId(asset),
      assetKind: asset.assetKind,
      pageNumber: asset.pageNumber,
      timestamp: asset.timestamp,
      thumbnailPath: asset.thumbnailPath,
      embeddingModels: visualEmbeddingModels(asset),
      faceEmbeddingModel: asset.faceEmbeddingModel,
    })),
  };
}

function findIndexEntry(index, target) {
  return index.find((item) =>
    item.filePath === target
    || item.path === target
    || item.id === target
    || path.basename(item.filePath) === target
  );
}

async function summarizeFileWithNvidia(index, request) {
  if (!request.consent) {
    throw new Error("Serve conferma: il riassunto AI invia il testo del file a NVIDIA.");
  }
  const target = String(request.filePath || request.path || request.id || "").trim();
  const entry = findIndexEntry(index, target);
  if (!entry) throw new Error("File non trovato nella ricerca locale.");
  if (!isSummarizableEntry(entry)) {
    throw new Error("Riassunto AI disponibile per testo, PDF, Word, fogli, presentazioni e codice.");
  }
  const text = fileSummaryText(entry, Number(request.maxChars || 24_000));
  if (text.length < 40) {
    throw new Error("Non ho abbastanza testo estratto da riassumere. Prova a preparare OCR o documenti.");
  }
  const cacheKey = summaryCacheKey(entry, text);
  const cachePath = path.join(AI_SUMMARY_DIR, `${cacheKey}.json`);
  if (!request.refresh) {
    const cached = await readJson(cachePath, null);
    if (cached?.summary) return { ...cached, fromCache: true };
  }

  const prompt = [
    "Sei Trova, un assistente file locale. Rispondi in italiano semplice.",
    "Devi riassumere il file per una preview desktop.",
    "Non inventare contenuti non presenti nel testo.",
    "Rispondi SOLO con JSON valido con queste chiavi:",
    "{",
    '  "summary": "riassunto breve in 4-6 frasi",',
    '  "bullets": ["5-8 punti chiave"],',
    '  "fileType": "che tipo di file sembra",',
    '  "usefulFor": "a cosa puo servire",',
    '  "questions": ["3 domande utili da fare al file"]',
    "}",
    "",
    `Nome file: ${entry.name}`,
    `Tipo: ${entry.kind}/${entry.extension}`,
    `Percorso: ${entry.filePath}`,
    "",
    "Testo estratto:",
    text,
  ].join("\n");

  const content = await nvidiaChatCompletion({
    messages: [
      { role: "system", content: "Rispondi sempre in JSON valido, senza markdown." },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
    maxTokens: 1200,
  });
  const parsed = normalizeNvidiaSummary(content);
  const result = {
    ...parsed,
    provider: "nvidia",
    model: NVIDIA_CHAT_MODEL,
    endpoint: NVIDIA_CHAT_URL,
    filePath: entry.filePath,
    fileName: entry.name,
    contentChars: text.length,
    generatedAt: Date.now(),
    fromCache: false,
  };
  await fs.writeFile(cachePath, JSON.stringify(result, null, 2)).catch(() => {});
  return result;
}

function isSummarizableEntry(entry) {
  if (entry.kind === "document" || entry.kind === "code") return true;
  return ["txt", "md", "csv", "json", "toml", "yaml", "yml", "pdf", "docx", "rtf", "odt", "pptx", "xlsx"].includes(entry.extension);
}

function fileSummaryText(entry, maxChars) {
  const chunks = entryTextChunks(entry).map((chunk) => String(chunk.text || "").trim()).filter(Boolean);
  const joined = chunks.length ? chunks.join("\n\n") : String(entry.content || "");
  return joined.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, Math.max(2000, Math.min(60_000, maxChars)));
}

function summaryCacheKey(entry, text) {
  return hash(`${entry.filePath}:${entry.fileHash || entry.modified || ""}:${NVIDIA_CHAT_MODEL}:${hash(text).slice(0, 24)}`).slice(0, 32);
}

async function nvidiaChatCompletion({ messages, temperature = 0.2, maxTokens = 1000 }) {
  if (process.env.TROVA_NVIDIA_MOCK_SUMMARY === "1") {
    return JSON.stringify({
      summary: "Riassunto di test generato senza chiamata esterna.",
      bullets: ["Punto chiave locale", "Contenuto disponibile", "Anteprima verificata"],
      fileType: "documento",
      usefulFor: "controllare la UI senza usare credito API",
      questions: ["Di cosa parla?", "Quali dettagli contiene?", "Cosa devo aprire?"],
    });
  }
  const keys = await discoverNvidiaApiKeys();
  if (!keys.length) {
    throw new Error("Chiave NVIDIA non trovata. Aggiungila in Documenti/Claude, .claude o nelle variabili ambiente.");
  }
  let lastError = "";
  for (let attempt = 0; attempt < keys.length; attempt += 1) {
    const keyIndex = (nvidiaKeyCursor + attempt) % keys.length;
    const key = keys[keyIndex];
    try {
      const response = await fetch(NVIDIA_CHAT_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key.key}`,
        },
        body: JSON.stringify({
          model: NVIDIA_CHAT_MODEL,
          messages,
          temperature,
          top_p: 0.7,
          max_tokens: maxTokens,
          stream: false,
        }),
        signal: AbortSignal.timeout(Number(process.env.TROVA_NVIDIA_TIMEOUT_MS || 90_000)),
      });
      const body = await response.text();
      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${safeNvidiaError(body)}`;
        continue;
      }
      const json = JSON.parse(body);
      const content = json?.choices?.[0]?.message?.content;
      if (!content) {
        lastError = "risposta NVIDIA senza contenuto";
        continue;
      }
      nvidiaKeyCursor = (keyIndex + 1) % keys.length;
      return String(content);
    } catch (err) {
      lastError = String(err?.message || err);
    }
  }
  throw new Error(`NVIDIA non ha risposto: ${lastError}`);
}

function safeNvidiaError(body) {
  return String(body || "")
    .replace(/nvapi-[A-Za-z0-9_-]+/g, "nvapi-***")
    .replace(/\s+/g, " ")
    .slice(0, 300);
}

function normalizeNvidiaSummary(content) {
  const raw = String(content || "").trim();
  const jsonText = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  let parsed = null;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const match = jsonText.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        parsed = null;
      }
    }
  }
  if (!parsed) {
    return {
      summary: raw.slice(0, 1800),
      bullets: [],
      fileType: "",
      usefulFor: "",
      questions: [],
    };
  }
  return {
    summary: String(parsed.summary || "").slice(0, 2200),
    bullets: arrayOfStrings(parsed.bullets).slice(0, 8),
    fileType: String(parsed.fileType || parsed.file_type || "").slice(0, 180),
    usefulFor: String(parsed.usefulFor || parsed.useful_for || "").slice(0, 500),
    questions: arrayOfStrings(parsed.questions).slice(0, 5),
  };
}

function arrayOfStrings(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

async function rerankWithNvidia(request) {
  const results = Array.isArray(request.results) ? request.results.slice(0, 18) : [];
  if (!String(request.query || "").trim() || results.length < 2) {
    return { orderedIds: results.map((item) => item.id), model: "local-order" };
  }
  try {
    const content = await nvidiaChatCompletion({
      messages: [
        { role: "system", content: "Sei un reranker. Rispondi solo JSON valido." },
        {
          role: "user",
          content: [
            "Ordina questi risultati per rilevanza rispetto alla query.",
            "Rispondi solo con JSON: {\"orderedIds\":[\"id1\",\"id2\"]}.",
            `Query: ${request.query}`,
            "Risultati:",
            JSON.stringify(results.map((item) => ({
              id: item.id,
              name: item.name,
              kind: item.kind,
              snippet: String(item.snippet || "").slice(0, 700),
              score: item.score,
            }))),
          ].join("\n"),
        },
      ],
      temperature: 0.1,
      maxTokens: 600,
    });
    const json = normalizeJsonObject(content);
    const ordered = Array.isArray(json?.orderedIds) ? json.orderedIds.map(String).filter((id) => results.some((item) => item.id === id)) : [];
    return { orderedIds: ordered.length ? ordered : results.map((item) => item.id), model: NVIDIA_CHAT_MODEL };
  } catch {
    return { orderedIds: results.map((item) => item.id), model: "local-order" };
  }
}

function normalizeJsonObject(content) {
  const raw = String(content || "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function retrieveTextChunks(index, question, filters, limit) {
  const embedded = await embedTextLocal(question);
  const queryVector = embedded.vector;
  const rows = [];
  const important = importantTerms(question);
  const minimumOverlap = important.length <= 2 ? 1 : 0.25;
  for (const entry of index) {
    if (!matchesFilter(entry.kind, filters)) continue;
    for (const chunk of entryTextChunks(entry)) {
      if (!Array.isArray(chunk.embedding) || chunk.embedding.length !== queryVector.length) continue;
      const semantic = vectorSimilarity(queryVector, chunk.embedding);
      const lexical = scoreMatch(`${entry.name} ${chunk.text}`.toLowerCase(), question.toLowerCase(), entry.name, chunk.text, entry.kind) / 180;
      const overlap = keywordOverlapScore(question, chunk.text);
      if (overlap < minimumOverlap && semantic < 0.68) continue;
      const score = (semantic * 0.78) + Math.min(0.28, lexical) + (overlap * 0.82);
      rows.push({ entry, chunk, score, semantic, lexical });
    }
  }
  rows.sort((a, b) => b.score - a.score);
  const best = rows[0]?.score || 0;
  return rows.filter((row) => row.score >= Math.max(0.34, best * 0.48)).slice(0, limit);
}

function buildExtractiveAnswer(question, chunks, citations) {
  if (!chunks.length) {
    return `Non ho trovato nei file locali un passaggio abbastanza vicino a "${question}".`;
  }
  const selected = [];
  for (const item of chunks.slice(0, 4)) {
    const sentence = bestSentenceForQuestion(item.chunk.text, question);
    if (sentence && !selected.some((existing) => existing.text === sentence)) {
      selected.push({ text: sentence, citation: citations[selected.length] || chunkCitation(item.entry, item.chunk, item.score) });
    }
  }
  const lines = selected.map((item, index) => `${index + 1}. ${item.text} [${index + 1}]`);
  const fileList = Array.from(new Set(chunks.slice(0, 4).map((item) => item.entry.name))).join(", ");
  return [
    `Risposta locale estrattiva su ${chunks.length} passaggi indicizzati.`,
    `File piu rilevanti: ${fileList}.`,
    ...lines,
  ].join("\n");
}

function bestSentenceForQuestion(text, question) {
  const sentences = String(text || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 24)
    .slice(0, 30);
  if (!sentences.length) return compactSnippet(text, question, 260);
  const scored = sentences.map((sentence) => ({
    sentence,
    score: scoreMatch(sentence.toLowerCase(), question.toLowerCase(), "", sentence, "document"),
  }));
  scored.sort((a, b) => b.score - a.score || b.sentence.length - a.sentence.length);
  return scored[0].sentence.slice(0, 360);
}

function resultFromEntry(entry, overrides = {}) {
  return {
    id: entry.filePath,
    name: entry.name,
    path: entry.filePath,
    kind: entry.kind,
    extension: entry.extension,
    size: entry.size,
    modified: entry.modified,
    snippet: overrides.snippet || makeSnippet(entry.content, "", entry.kind),
    score: overrides.score || 1,
    source: "local",
    sourceType: entry.sourceType || "local",
    remoteId: entry.remoteId,
    remotePath: entry.remotePath,
    syncMode: entry.syncMode,
    visual_preview: overrides.visual_preview || entry.visualAssets?.[0]?.thumbnailPath,
    page_hint: overrides.page_hint || entry.visualAssets?.[0]?.pageNumber,
    pageNumber: overrides.pageNumber || overrides.page_hint || entry.visualAssets?.[0]?.pageNumber,
    timestamp: overrides.timestamp,
    matchType: overrides.matchType || "semantic",
    citations: overrides.citations || [],
    assetId: overrides.assetId,
    previewKind: overrides.previewKind || entry.visualAssets?.[0]?.assetKind,
    rankBreakdown: overrides.rankBreakdown || {},
  };
}

function entryTextChunks(entry) {
  if (Array.isArray(entry.textChunks) && entry.textChunks.length) return entry.textChunks;
  return (entry.chunks || []).map((text, chunkIndex) => ({
    chunkId: hash(`${entry.filePath}:${chunkIndex}:${hash(text).slice(0, 12)}`).slice(0, 24),
    filePath: entry.filePath,
    chunkIndex,
    text,
    embedding: lexicalEmbedding(text),
    embeddingModel: LEXICAL_EMBEDDING_MODEL,
    embeddingReady: true,
  }));
}

function documentEmbedding(entry) {
  const chunks = entryTextChunks(entry).filter((chunk) => Array.isArray(chunk.embedding) && chunk.embedding.length);
  if (!chunks.length) return lexicalEmbedding(entry.content || entry.name || entry.filePath);
  const vector = new Array(chunks[0].embedding.length).fill(0);
  for (const chunk of chunks) {
    for (let index = 0; index < vector.length; index += 1) vector[index] += chunk.embedding[index] || 0;
  }
  return normalizeVector(vector.map((value) => value / chunks.length));
}

function chunkCitation(entry, chunk, score) {
  return {
    title: entry.name,
    filePath: entry.filePath,
    pageNumber: chunk.pageNumber,
    chunkIndex: chunk.chunkIndex,
    score: Number(Math.min(1, Math.max(0, score)).toFixed(4)),
    snippet: compactSnippet(chunk.text, "", 280),
  };
}

function compactSnippet(text, query = "", size = 320) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const lower = normalized.toLowerCase();
  const term = tokenizeSearchText(query).find((item) => lower.includes(item));
  const pos = term ? lower.indexOf(term) : 0;
  return normalized.slice(Math.max(0, pos - 80), Math.min(normalized.length, pos + size)).trim();
}

function keywordOverlapScore(query, text) {
  const queryTerms = importantTerms(query);
  if (!queryTerms.length) return 0;
  const textTerms = new Set(tokenizeSearchText(text));
  let hits = 0;
  for (const term of queryTerms) {
    if (textTerms.has(term) || bestFuzzyToken(term, Array.from(textTerms).slice(0, 900)).score > 0) hits += 1;
  }
  return hits / queryTerms.length;
}

function importantTerms(value) {
  const stop = new Set([
    "dove", "come", "cosa", "quale", "quali", "quando", "perche", "perchè", "parla", "parlano",
    "dice", "riassumi", "riassunto", "file", "documento", "documenti", "trova", "cerca", "si", "di", "e", "il", "lo", "la",
    "gli", "le", "un", "una", "uno", "nel", "nella", "nei", "nelle", "del", "della", "dei", "delle",
    "con", "su", "sul", "sulla", "a", "da", "in", "che",
  ]);
  return tokenizeSearchText(value).filter((term) => term.length > 2 && !stop.has(term));
}

function bestVisualAsset(assets, queries) {
  if (!queries.length) return null;
  let best = null;
  let bestScore = 0;
  for (const asset of assets) {
    for (const query of queries) {
      for (const vector of visualVectors(asset)) {
        const score = visualSimilarity(query, vector);
        if (score > bestScore) {
          best = asset;
          bestScore = score;
        }
      }
    }
  }
  return best;
}

function bestVisualScore(assets, queries) {
  let best = 0;
  for (const asset of assets) {
    const vectors = visualVectors(asset);
    for (const query of queries) {
      for (const vector of vectors) {
        best = Math.max(best, visualSimilarity(query, vector));
      }
    }
  }
  return best;
}

function bestFaceAsset(assets, queries) {
  if (!queries.length) return null;
  let best = null;
  let bestScore = 0;
  for (const asset of assets) {
    for (const query of queries) {
      for (const vector of faceVectors(asset)) {
        const score = visualSimilarity(query, vector);
        if (score > bestScore) {
          best = asset;
          bestScore = score;
        }
      }
    }
  }
  return best;
}

function bestFaceScore(assets, queries) {
  let best = 0;
  for (const asset of assets) {
    const vectors = faceVectors(asset);
    for (const query of queries) {
      for (const vector of vectors) {
        best = Math.max(best, visualSimilarity(query, vector));
      }
    }
  }
  return best;
}

function faceVectors(asset) {
  return Array.isArray(asset.faceEmbedding) && asset.faceEmbedding.length ? [asset.faceEmbedding] : [];
}

function dedupeResults(results) {
  const byKey = new Map();
  for (const result of results) {
    const key = `${result.id}:${result.assetId || ""}:${result.matchType || ""}`;
    const existing = byKey.get(key);
    if (!existing || result.score > existing.score) byKey.set(key, result);
  }
  return Array.from(byKey.values());
}

function visualVectors(asset) {
  const vectors = [];
  if (Array.isArray(asset.embedding) && asset.embedding.length) vectors.push(asset.embedding);
  for (const item of asset.visualEmbeddings || []) {
    if (Array.isArray(item.vector) && item.vector.length) vectors.push(item.vector);
  }
  return vectors;
}

function visualSimilarity(a, b) {
  return vectorSimilarity(a, b);
}

function vectorSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
  let score = 0;
  for (let i = 0; i < a.length; i += 1) score += a[i] * b[i];
  return Math.max(0, score);
}

function visualMatchSnippet(query, kind, visualScore, mode = "image") {
  const confidence = Math.round(visualScore * 100);
  if (mode === "person") return `Corrispondenza persona/volto locale esplicita, senza identificazione nominale. Somiglianza ${confidence}%.`;
  if (kind === "image") return `Immagine associata a "${query || "query immagine"}" tramite vision locale. Somiglianza ${confidence}%.`;
  if (kind === "document") return `Documento con preview o pagina associata a "${query || "query immagine"}". Somiglianza ${confidence}%.`;
  return `Corrispondenza visuale locale. Somiglianza ${confidence}%.`;
}

function scoreMatch(haystack, query, name, content, kind) {
  let score = 0;
  const nameLower = name.toLowerCase();
  const bodyLower = String(content || "").toLowerCase();
  const nameTokens = tokenizeSearchText(nameLower);
  const bodyTokens = tokenizeSearchText(bodyLower).slice(0, 1600);
  for (const term of tokenizeSearchText(query).filter((item) => item.length > 1)) {
    let matched = false;
    if (nameLower.includes(term)) score += 80;
    if (bodyLower.includes(term)) {
      score += 45;
      matched = true;
    }
    if (haystack.includes(term)) {
      score += 15;
      matched = true;
    }
    if (!matched && term.length >= 4) {
      const nameFuzzy = bestFuzzyToken(term, nameTokens);
      const bodyFuzzy = bestFuzzyToken(term, bodyTokens);
      if (nameFuzzy.score > 0) score += nameFuzzy.score + 34;
      if (bodyFuzzy.score > 0) score += bodyFuzzy.score + 18;
    }
  }
  if (["image", "audio", "video"].includes(kind) && nameLower.includes(query)) score += 50;
  return score;
}

function makeSnippet(text, query, kind) {
  if (!text?.trim()) {
    if (kind === "image") return "Corrispondenza su nome file o metadati immagine.";
    if (kind === "audio") return "Corrispondenza su nome file o metadati audio.";
    if (kind === "video") return "Corrispondenza su nome file o metadati video.";
    return "Nessuna anteprima testuale disponibile.";
  }
  const normalized = text.replace(/\s+/g, " ");
  const lower = normalized.toLowerCase();
  const terms = tokenizeSearchText(query);
  const exact = terms.find((term) => lower.includes(term));
  const fuzzy = exact ? "" : fuzzySnippetAnchor(lower, terms);
  const pos = exact ? lower.indexOf(exact) : fuzzy ? lower.indexOf(fuzzy) : 0;
  return normalized.slice(Math.max(0, pos - 90), Math.min(normalized.length, pos + 240)).trim();
}

function tokenizeSearchText(value) {
  return normalizeSearchText(value).split(/\s+/).filter(Boolean);
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function bestFuzzyToken(term, tokens) {
  let best = { token: "", score: 0 };
  const unique = Array.from(new Set(tokens)).slice(0, 900);
  for (const token of unique) {
    if (Math.abs(token.length - term.length) > Math.max(2, Math.ceil(term.length * 0.35))) continue;
    if (token[0] !== term[0] && token.at(-1) !== term.at(-1)) continue;
    const distance = levenshtein(term, token, 4);
    const allowed = term.length <= 5 ? 1 : term.length <= 9 ? 2 : 3;
    const trigram = trigramSimilarity(term, token);
    if (distance <= allowed || trigram >= 0.46) {
      const score = Math.max(6, Math.round((1 - Math.min(distance, allowed + 1) / (allowed + 2)) * 28), Math.round(trigram * 24));
      if (score > best.score) best = { token, score };
    }
  }
  return best;
}

function fuzzySnippetAnchor(lowerText, terms) {
  const tokens = tokenizeSearchText(lowerText).slice(0, 900);
  for (const term of terms) {
    const best = bestFuzzyToken(term, tokens);
    if (best.token) return best.token;
  }
  return "";
}

function levenshtein(a, b, max = Infinity) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    let rowBest = previous[0];
    for (let j = 1; j <= b.length; j += 1) {
      const old = previous[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + cost);
      diagonal = old;
      rowBest = Math.min(rowBest, previous[j]);
    }
    if (rowBest > max) return max + 1;
  }
  return previous[b.length];
}

function trigramSimilarity(a, b) {
  const left = trigrams(a);
  const right = trigrams(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  return (2 * intersection) / (left.size + right.size);
}

function trigrams(value) {
  const padded = `  ${value} `;
  const out = new Set();
  for (let index = 0; index < padded.length - 2; index += 1) out.add(padded.slice(index, index + 3));
  return out;
}

async function syncTypesenseIndex(index) {
  if (!(await typesenseHealthy())) {
    lastTypesenseError = "Typesense offline";
    return false;
  }
  lastTypesenseError = "";
  const exists = await fetch(`${TYPESENSE_URL}/collections/${TYPESENSE_COLLECTION}`, {
    headers: typesenseHeaders(),
  }).then((response) => response.ok).catch(() => false);
  if (exists) {
    await fetch(`${TYPESENSE_URL}/collections/${TYPESENSE_COLLECTION}`, {
      method: "DELETE",
      headers: typesenseHeaders(),
    }).catch(() => null);
  }
  const createResponse = await fetch(`${TYPESENSE_URL}/collections`, {
    method: "POST",
    headers: { ...typesenseHeaders(), "content-type": "application/json" },
    body: JSON.stringify({
      name: TYPESENSE_COLLECTION,
      fields: [
        { name: "file_path", type: "string", facet: true },
        { name: "name", type: "string" },
        { name: "kind", type: "string", facet: true },
        { name: "extension", type: "string", facet: true },
        { name: "content", type: "string" },
        { name: "modified", type: "int64" },
        { name: "size", type: "int64" },
      ],
      default_sorting_field: "modified",
    }),
  });
  if (!createResponse.ok && createResponse.status !== 409) throw new Error(`Typesense create ${createResponse.status}`);
  if (!index.length) return true;
  const body = index.map((entry) => JSON.stringify({
    id: hash(entry.filePath).slice(0, 32),
    file_path: entry.filePath,
    name: entry.name || path.basename(entry.filePath),
    kind: entry.kind || "other",
    extension: entry.extension || "",
    content: String(entry.content || "").slice(0, MAX_TEXT_BYTES),
    modified: Number(entry.modified || 0),
    size: Number(entry.size || 0),
  })).join("\n");
  const response = await fetch(`${TYPESENSE_URL}/collections/${TYPESENSE_COLLECTION}/documents/import?action=upsert`, {
    method: "POST",
    headers: { ...typesenseHeaders(), "content-type": "text/plain" },
    body,
  });
  if (!response.ok) throw new Error(`Typesense import ${response.status}`);
  return true;
}

async function searchTypesense(query, filters) {
  if (!(await typesenseHealthy())) {
    lastTypesenseError = "Typesense offline";
    return new Map();
  }
  const params = new URLSearchParams({
    q: query,
    query_by: "name,content,file_path",
    per_page: "120",
    num_typos: "2",
    typo_tokens_threshold: "1",
    exhaustive_search: "true",
  });
  const filterBy = typesenseFilter(filters);
  if (filterBy) params.set("filter_by", filterBy);
  const response = await fetch(`${TYPESENSE_URL}/collections/${TYPESENSE_COLLECTION}/documents/search?${params.toString()}`, {
    headers: typesenseHeaders(),
    signal: AbortSignal.timeout(1800),
  });
  if (!response.ok) return new Map();
  const payload = await response.json();
  const matches = new Map();
  for (const [index, hit] of (payload.hits || []).entries()) {
    const filePath = hit.document?.file_path;
    if (!filePath) continue;
    matches.set(filePath, { score: Math.max(12, 78 - index), highlight: hit.highlights?.[0]?.snippet || "" });
  }
  return matches;
}

function typesenseFilter(filters) {
  if (!filters?.length || filters.includes("all")) return "";
  if (filters.includes("text")) return "kind:=[document,code]";
  if (filters.includes("images")) return "kind:=image";
  if (filters.includes("documents")) return "kind:=document";
  return `kind:=[${filters.map((item) => String(item).replace(/[^\w-]/g, "")).filter(Boolean).join(",")}]`;
}

async function typesenseHealthy() {
  const response = await fetch(`${TYPESENSE_URL}/health`, {
    headers: typesenseHeaders(),
    signal: AbortSignal.timeout(900),
  }).catch(() => null);
  return Boolean(response?.ok);
}

function typesenseHeaders() {
  return { "X-TYPESENSE-API-KEY": TYPESENSE_API_KEY };
}

function rememberTypesenseError(err) {
  lastTypesenseError = String(err?.message || err || "");
}

async function readImageDataUrl(filePath) {
  const bytes = await fs.readFile(filePath);
  return `data:${mime(ext(filePath))};base64,${bytes.toString("base64")}`;
}

async function readFileDataUrl(filePath) {
  const stat = await fs.stat(filePath);
  if (stat.size > 120 * 1024 * 1024) {
    throw new Error("File troppo grande per la preview integrata");
  }
  const bytes = await fs.readFile(filePath);
  const mimeType = mime(ext(filePath));
  return {
    dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
    mimeType,
    size: stat.size,
  };
}

async function openInFolder(filePath) {
  await fs.access(filePath);
  if (process.platform === "win32") {
    await execFile("explorer", [`/select,${filePath}`]);
    return;
  }
  if (process.platform === "darwin") {
    await execFile("open", ["-R", filePath]);
    return;
  }
  await execFile("xdg-open", [path.dirname(filePath)]);
}

function listVisualAssets(state) {
  return (state.index || []).flatMap((entry) =>
    (entry.visualAssets || []).flatMap((asset) => {
      const imagePath = asset.thumbnailPath || asset.filePath;
      return imagePath
        ? [{
            assetId: visualAssetId(asset),
            filePath: asset.filePath,
            imagePath,
            assetKind: asset.assetKind,
            pageNumber: asset.pageNumber,
            timestamp: asset.timestamp,
            embeddingModel: asset.embeddingModel,
            embeddingModels: visualEmbeddingModels(asset),
            faceEmbeddingModel: asset.faceEmbeddingModel,
          }]
        : [];
    }),
  );
}

function updateVisualAssetEmbedding(state, assetId, model, vector) {
  if (!assetId || !model || !Array.isArray(vector) || !vector.length) {
    throw new Error("Embedding visuale non valido");
  }
  let updated = false;
  for (const entry of state.index || []) {
    for (const asset of entry.visualAssets || []) {
      if (visualAssetId(asset) !== assetId) continue;
      asset.visualEmbeddings ||= [];
      const existing = asset.visualEmbeddings.find((item) => item.model === model);
      if (existing) existing.vector = vector;
      else asset.visualEmbeddings.push({ model, vector });
      asset.embedding = vector;
      asset.embeddingModel = model;
      updated = true;
    }
  }
  if (!updated) throw new Error("Asset visuale non trovato");
  return localVisionStatus(state);
}

function localVisionStatus(state) {
  const models = [
    { model: "trova-fingerprint-v1", label: "Fingerprint" },
    { model: FACE_FINGERPRINT_MODEL, label: "Persona" },
    { model: "Xenova/clip-vit-base-patch32", label: "CLIP" },
    { model: "onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX", label: "DINOv3" },
    { model: "onnx-community/siglip2-base-patch16-224-ONNX", label: "SigLIP2" },
  ];
  const assets = (state.index || []).flatMap((entry) => entry.visualAssets || []);
  const counts = models.map((model) => model.model === FACE_FINGERPRINT_MODEL
    ? assets.filter((asset) => asset.faceEmbeddingModel === FACE_FINGERPRINT_MODEL).length
    : assets.filter((asset) => visualEmbeddingModels(asset).includes(model.model)).length);
  const embeddedAssets = assets.filter((asset) => visualEmbeddingModels(asset).length > 0).length;
  return {
    totalAssets: assets.length,
    embeddedAssets,
    faceEmbeddedAssets: assets.filter((asset) => asset.faceEmbeddingModel).length,
    model: "CLIP + DINOv3 + SigLIP2",
    models: models.map((model, index) => ({
      ...model,
      embeddedAssets: counts[index],
      totalAssets: assets.length,
    })),
  };
}

function semanticStatus(state) {
  const entries = state.index || [];
  const chunks = entries.flatMap((entry) => entryTextChunks(entry));
  const embeddedChunks = chunks.filter((chunk) => Array.isArray(chunk.embedding) && chunk.embedding.length === TEXT_EMBEDDING_DIM).length;
  const models = new Map();
  for (const chunk of chunks) {
    const model = chunk.embeddingModel || "sconosciuto";
    models.set(model, (models.get(model) || 0) + 1);
  }
  return {
    model: textEmbeddingStatus.fallback ? LEXICAL_EMBEDDING_MODEL : TEXT_EMBEDDING_MODEL,
    primaryModel: TEXT_EMBEDDING_MODEL,
    fallbackModel: LEXICAL_EMBEDDING_MODEL,
    ready: embeddedChunks > 0,
    runtimeReady: textEmbeddingStatus.ready,
    fallback: textEmbeddingStatus.fallback,
    error: textEmbeddingStatus.error,
    totalChunks: chunks.length,
    embeddedChunks,
    filesWithChunks: entries.filter((entry) => entryTextChunks(entry).length > 0).length,
    models: Array.from(models, ([model, count]) => ({ model, count })),
  };
}

async function doctorStatus(state) {
  const [components, packaging, rclone, permissions, models] = await Promise.all([
    localComponentsStatus(state),
    packagingStatus(),
    rcloneStatus(state),
    permissionChecks(state),
    modelStatus(state),
  ]);
  const index = indexStatus(state);
  const checks = [
    ...components.map((component) => ({
      id: `component:${component.id}`,
      label: component.label,
      category: component.category,
      state: componentState(component),
      required: Boolean(component.required),
      detail: component.version || component.status,
      action: component.installable === false ? "manual" : component.installed ? "test" : "install",
      hint: component.installHint,
    })),
    ...packaging.checks.map((check) => ({
      id: `packaging:${check.id}`,
      label: check.label,
      category: "Desktop",
      state: check.ok ? "ready" : "missing",
      required: true,
      detail: check.detail,
      action: check.ok ? "none" : "manual",
      hint: "Completa il preflight packaging prima del bundle desktop.",
    })),
    ...permissions,
    {
      id: "privacy:cloud-opt-in",
      label: "Cloud opt-in",
      category: "Privacy",
      state: (state.watchPaths || []).some((item) => item.geminiEnabled) ? "manual" : "ready",
      required: true,
      detail: (state.watchPaths || []).some((item) => item.geminiEnabled)
        ? "Almeno una cartella ha Gemini attivo in modo esplicito."
        : "Nessuna cartella invia file al cloud.",
      action: "none",
      hint: "Gemini/NVIDIA restano spenti finche non li abiliti.",
    },
    {
      id: "remote-access",
      label: "Remote Access",
      category: "Sicurezza",
      state: state.remoteAccess?.enabled ? "manual" : "ready",
      required: false,
      detail: state.remoteAccess?.enabled ? "Web UI remota attiva con token." : "Web UI remota spenta di default.",
      action: "none",
      hint: "Attivala solo quando ti serve accesso da rete o LAN.",
    },
  ];
  const required = checks.filter((check) => check.required);
  const readyRequired = required.filter((check) => check.state === "ready" || check.state === "manual").length;
  const missingRequired = required.filter((check) => check.state === "missing").length;
  const installable = checks.filter((check) => check.action === "install").length;
  return {
    generatedAt: Date.now(),
    summary: {
      state: missingRequired ? "attention" : "ready",
      readyRequired,
      required: required.length,
      missingRequired,
      installable,
      warnings: checks.filter((check) => check.state === "manual").length,
    },
    index,
    semantic: semanticStatus(state),
    vision: localVisionStatus(state),
    models,
    packaging: sanitizePackagingStatus(packaging),
    rclone: {
      installed: rclone.installed,
      command: rclone.command,
      remotes: rclone.remotes,
      cacheRoot: rclone.cacheRoot,
    },
    remoteAccess: remoteAccessStatus(state),
    checks,
    logPath: DIAGNOSTIC_LOG,
  };
}

async function simpleAppStatus(state) {
  const [doctor, components] = await Promise.all([
    doctorStatus(state),
    localComponentsStatus(state),
  ]);
  const job = state.autoSetupJob || null;
  const running = job?.status === "running";
  const rawIssues = doctor.checks
    .filter((check) => check.required && check.state === "missing")
    .map(friendlyIssueFromCheck)
    .filter(Boolean);
  const missingInstallable = rawIssues.some((issue) => issue.action === "install");
  const status = running
    ? "preparing"
    : rawIssues.length
      ? missingInstallable ? "needs_permission" : "attention"
      : "ready";
  const title = running
    ? "Sto preparando"
    : status === "ready"
      ? "Tutto pronto"
      : status === "needs_permission"
        ? "Serve conferma"
        : "Qualcosa non va";
  const message = running
    ? job.message || "Sto sistemando quello che serve in background."
    : status === "ready"
      ? "Puoi cercare nei file, nelle foto e nei video scelti."
      : status === "needs_permission"
        ? "Posso sistemare quasi tutto da solo, ma per alcune cose il sistema potrebbe chiederti conferma."
        : "Ho trovato qualcosa da sistemare. Provo a ripararlo io oppure puoi aprire i dettagli.";
  return {
    generatedAt: Date.now(),
    status,
    title,
    message,
    progress: running ? Number(job.progress || 0) : status === "ready" ? 100 : 0,
    actionLabel: running ? "Preparazione in corso" : status === "ready" ? "Controlla" : "Sistema",
    issues: rawIssues.slice(0, 8),
    sections: [
      simpleSection("files", "File e documenti", doctor.index.filesIndexed > 0 || !rawIssues.some((item) => item.area === "files"), `${doctor.index.filesIndexed || 0} file pronti`),
      simpleSection("media", "Foto e video", true, simpleMediaMessage(doctor.vision)),
      simpleSection("updates", "Aggiornamenti", Boolean(doctor.index.watcherActive), doctor.index.watcherActive ? "Attivi" : "Da avviare"),
      simpleSection("outside", "Archivi esterni", doctor.rclone.installed || doctor.index.remoteConnectors === 0, `${doctor.index.remoteConnectors || 0} collegati`),
    ],
    job: job || emptyAutoSetupJob(),
    components: runtimeInstallTasks(components),
    detailsAvailable: true,
    technical: {
      logPath: DIAGNOSTIC_LOG,
      summary: doctor.summary,
      dataDir: DATA_DIR,
      runtimeDir: RUNTIME_DIR,
    },
  };
}

function simpleSection(id, label, ready, message) {
  return {
    id,
    label,
    ready: Boolean(ready),
    state: ready ? "ready" : "needs_attention",
    message,
  };
}

function simpleMediaMessage(vision) {
  const total = vision?.totalAssets || 0;
  if (!total) return "Pronte quando aggiungi immagini o video";
  return `${vision.embeddedAssets || 0}/${total} elementi pronti`;
}

function friendlyIssueFromCheck(check) {
  const componentId = String(check.id || "").replace(/^component:/, "");
  const isPermission = String(check.id || "").startsWith("permission:");
  const title = isPermission
    ? "Serve un permesso"
    : String(check.id || "").startsWith("packaging:")
      ? "App desktop da completare"
      : friendlyComponentName(componentId || check.label);
  const action = check.action === "install" ? "install" : "manual";
  return {
    id: check.id,
    title,
    message: isPermission
      ? "Trova deve poter leggere le cartelle scelte e salvare i suoi dati."
      : action === "install"
        ? "Posso prepararlo io in background."
        : "Serve un passaggio del sistema o una scelta manuale.",
    action,
    actionLabel: action === "install" ? "Sistema" : "Apri dettagli",
    severity: check.required ? "required" : "optional",
    area: friendlyIssueArea(check),
    technicalId: check.id,
  };
}

function friendlyIssueArea(check) {
  const id = String(check.id || "");
  if (id.includes("tesseract") || id.includes("poppler") || id.includes("tika") || id.includes("typesense")) return "files";
  if (id.includes("ffmpeg") || id.includes("whisper") || id.includes("vision")) return "media";
  if (id.includes("rclone")) return "outside";
  return "app";
}

function friendlyComponentName(idOrLabel) {
  const id = String(idOrLabel || "").toLowerCase();
  const names = {
    "desktop-runtime": "App desktop",
    tika: "Lettura documenti",
    typesense: "Ricerca veloce",
    "text-embeddings": "Domande sui file",
    ffmpeg: "Video",
    ffprobe: "Dettagli video",
    poppler: "Anteprime PDF",
    "vision-fingerprint": "Ricerca per immagini",
    "vision-neural": "Somiglianza foto",
    tesseract: "Testo nelle immagini",
    whisper: "Parole in audio e video",
    rclone: "Archivi esterni",
    docker: "Servizi locali",
  };
  return names[id] || String(idOrLabel || "Preparazione");
}

function runtimeInstallTasks(components = []) {
  return components.map((component) => ({
    id: component.id,
    label: friendlyComponentName(component.id),
    state: component.installed ? "ready" : component.required ? "missing" : "optional",
    ready: Boolean(component.installed),
    required: Boolean(component.required),
    installable: component.installable !== false,
    actionLabel: component.installed ? "Pronto" : component.required ? "Sistema" : "Facoltativo",
    message: component.installed
      ? "Pronto"
      : component.required
        ? "Lo preparo in automatico quando possibile."
        : "Puoi attivarlo quando ti serve.",
    technical: {
      label: component.label,
      category: component.category,
      status: component.status,
      version: component.version,
      hint: component.installHint,
    },
  }));
}

function emptyAutoSetupJob() {
  return {
    id: "",
    status: "idle",
    title: "Pronto a preparare",
    message: "Scegli le cartelle e premi Prepara tutto.",
    progress: 0,
    startedAt: null,
    updatedAt: null,
    finishedAt: null,
    plan: createAutoSetupPlan(),
    steps: [],
    issues: [],
  };
}

function createAutoSetupPlan() {
  return {
    id: "auto-setup",
    title: "Preparazione automatica",
    runtimeDir: RUNTIME_DIR,
    steps: [
      { id: "check", label: "Controllo il PC", message: "Verifico cartelle e permessi." },
      { id: "prepare", label: "Preparo gli strumenti", message: "Sistema i lettori dei file e i servizi locali quando possibile." },
      { id: "models", label: "Preparo l'intelligenza locale", message: "Scarico o scaldo i modelli che restano sul dispositivo." },
      { id: "index", label: "Leggo i file scelti", message: "Creo la ricerca per documenti, foto, audio e video." },
      { id: "updates", label: "Attivo gli aggiornamenti", message: "Tengo d'occhio le cartelle senza rifare tutto." },
    ],
  };
}

async function startAutoSetup(args = {}) {
  const state = await loadState();
  if (state.autoSetupJob?.status === "running" && activeAutoSetupPromise) return state.autoSetupJob;
  const paths = normalizeSetupPaths(args.paths, state.watchPaths || defaultWatchPaths());
  const plan = createAutoSetupPlan();
  const job = {
    id: hash(`${Date.now()}:${Math.random()}`).slice(0, 18),
    status: "running",
    title: "Sto preparando Trova",
    message: "Controllo il PC e preparo tutto in background.",
    progress: 2,
    currentStep: plan.steps[0].id,
    plan,
    steps: plan.steps.map((step) => ({ ...step, state: "pending", startedAt: null, finishedAt: null, detail: "" })),
    issues: [],
    startedAt: Date.now(),
    updatedAt: Date.now(),
    finishedAt: null,
    repair: Boolean(args.repair),
    allowSystemChanges: args.allowSystemChanges !== false,
  };
  state.watchPaths = paths;
  state.autoSetupJob = job;
  await saveState(state);
  activeAutoSetupPromise = runAutoSetupJob(job.id, { ...args, paths })
    .catch((err) => failAutoSetupJob(job.id, err))
    .finally(() => {
      activeAutoSetupPromise = null;
    });
  return job;
}

async function repairApp(args = {}) {
  return startAutoSetup({ ...args, repair: true });
}

function normalizeSetupPaths(paths, fallback) {
  const source = Array.isArray(paths) && paths.length ? paths : fallback;
  return source.map((item) => {
    if (typeof item === "string") return watchPath(item, true);
    return {
      sourceType: "local",
      autoIndex: true,
      recursive: true,
      geminiEnabled: false,
      isExcluded: false,
      enabled: true,
      ...item,
    };
  });
}

async function runAutoSetupJob(jobId, args = {}) {
  const steps = createAutoSetupPlan().steps;
  await runAutoSetupStep(jobId, steps, "check", 8, async () => {
    await doctorStatus(await loadState());
    return { message: "Controllo completato." };
  });
  await runAutoSetupStep(jobId, steps, "prepare", 34, async () => autoPrepareRuntime(args));
  await runAutoSetupStep(jobId, steps, "models", 52, async () => {
    const result = await warmupLocalModels({});
    return {
      ok: result.ok,
      message: result.ok ? "Intelligenza locale pronta." : "Ho preparato quello che potevo, continuo con la ricerca.",
      issues: result.ok ? [] : [{ title: "Modelli da completare", message: "Li riprovero in background.", actionLabel: "Riprova" }],
    };
  });
  await runAutoSetupStep(jobId, steps, "index", 82, async () => autoBuildIndex(args));
  await runAutoSetupStep(jobId, steps, "updates", 96, async () => autoStartWatcher(args));
  await updateAutoSetupJob(jobId, {
    status: "done",
    title: "Tutto pronto",
    message: "Trova e pronto per cercare nei file scelti.",
    progress: 100,
    currentStep: "",
    finishedAt: Date.now(),
  });
}

async function runAutoSetupStep(jobId, allSteps, stepId, progressAfter, task) {
  await updateAutoSetupJob(jobId, {
    currentStep: stepId,
    message: allSteps.find((step) => step.id === stepId)?.message || "Sto preparando.",
  }, { id: stepId, state: "running", startedAt: Date.now(), detail: "" });
  try {
    const result = await task();
    await updateAutoSetupJob(jobId, {
      progress: progressAfter,
      message: result?.message || "Fatto.",
      issues: result?.issues || undefined,
    }, {
      id: stepId,
      state: result?.ok === false ? "attention" : "done",
      finishedAt: Date.now(),
      detail: result?.message || "",
    });
  } catch (err) {
    await updateAutoSetupJob(jobId, {
      message: "Qualcosa non e andato, provo a proseguire.",
      issues: [{ title: "Passaggio da riprovare", message: "Non sono riuscito a completare una parte della preparazione.", actionLabel: "Riprova", technicalError: String(err?.message || err) }],
    }, {
      id: stepId,
      state: "attention",
      finishedAt: Date.now(),
      detail: String(err?.message || err),
    });
  }
}

async function updateAutoSetupJob(jobId, patch = {}, stepPatch = null) {
  const state = await loadState();
  if (state.autoSetupJob?.id !== jobId) return null;
  const current = state.autoSetupJob;
  const next = {
    ...current,
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
    updatedAt: Date.now(),
  };
  if (patch.issues) next.issues = [...(current.issues || []), ...patch.issues];
  if (stepPatch?.id) {
    next.steps = (current.steps || []).map((step) => step.id === stepPatch.id ? { ...step, ...stepPatch } : step);
  }
  state.autoSetupJob = next;
  await saveState(state);
  return next;
}

async function failAutoSetupJob(jobId, err) {
  await updateAutoSetupJob(jobId, {
    status: "failed",
    title: "Qualcosa non va",
    message: "Non sono riuscito a completare la preparazione. Puoi riprovare.",
    progress: 0,
    finishedAt: Date.now(),
    issues: [{ title: "Preparazione interrotta", message: "Premi Riprova: non perdo i file gia preparati.", actionLabel: "Riprova", technicalError: String(err?.message || err) }],
  });
}

async function autoPrepareRuntime(args = {}) {
  await Promise.all([
    fs.mkdir(RUNTIME_DIR, { recursive: true }),
    fs.mkdir(BIN_DIR, { recursive: true }),
    fs.mkdir(MODEL_DIR, { recursive: true }),
  ]);
  const state = await loadState();
  const components = await localComponentsStatus(state);
  const missing = components.filter((component) => !component.installed && component.installable !== false);
  const ids = canonicalInstallIds(missing.map((component) => component.id));
  const issues = [];
  const prepared = [];
  if (args.allowSystemChanges === false) {
    return {
      ok: true,
      message: "Preparazione controllata. Nessuna modifica automatica richiesta in questo test.",
      tasks: runtimeInstallTasks(components),
    };
  }
  for (const id of ids) {
    if (!autoInstallAllowed(id)) {
      issues.push({ title: friendlyComponentName(id), message: "Serve una conferma del sistema o una scelta manuale.", actionLabel: "Apri dettagli", technicalId: id });
      continue;
    }
    try {
      const result = await installLocalComponent(id);
      prepared.push(friendlyComponentName(id));
      if (!result.ok) {
        issues.push({ title: friendlyComponentName(id), message: "Non sono riuscito a sistemarlo da solo.", actionLabel: "Apri dettagli", technicalId: id });
      }
    } catch (err) {
      issues.push({ title: friendlyComponentName(id), message: "Serve un passaggio manuale o un nuovo tentativo.", actionLabel: "Riprova", technicalId: id, technicalError: String(err?.message || err) });
    }
  }
  return {
    ok: issues.length === 0,
    message: prepared.length
      ? `Ho preparato ${prepared.slice(0, 3).join(", ")}${prepared.length > 3 ? " e altro" : ""}.`
      : "Gli strumenti locali sono gia pronti o richiedono conferma.",
    issues,
    tasks: runtimeInstallTasks(await localComponentsStatus(await loadState())),
  };
}

function canonicalInstallIds(ids) {
  const out = new Set();
  for (const id of ids) {
    if (id === "typesense") out.add("tika");
    else if (id === "ffprobe") out.add("ffmpeg");
    else if (id === "text-embeddings" || id === "vision-fingerprint" || id === "vision-neural") continue;
    else out.add(id);
  }
  return Array.from(out);
}

function autoInstallAllowed(id) {
  return new Set(["desktop-runtime", "tika", "ffmpeg", "poppler", "tesseract", "whisper", "rclone"]).has(id);
}

async function autoBuildIndex(args = {}) {
  const previous = await loadState();
  const watchPaths = normalizeSetupPaths(args.paths, previous.watchPaths || defaultWatchPaths());
  const syncResult = await syncAutoRemoteConnectors({
    ...previous,
    watchPaths,
    connectors: previous.connectors || [],
  });
  const effectiveWatchPaths = syncResult.state.watchPaths || watchPaths;
  const { index, stats } = await buildIndex(effectiveWatchPaths, previous.index || []);
  const state = {
    ...syncResult.state,
    watchPaths: effectiveWatchPaths,
    index,
    lastIndexStats: { ...stats, remotesSynced: syncResult.summary.synced, remoteErrors: syncResult.summary.errors },
    lastIndexedAt: Date.now(),
    watcherRoots: watcherRoots(effectiveWatchPaths),
  };
  await saveState(state);
  await syncTypesenseIndex(index).catch((err) => rememberTypesenseError(err));
  return {
    ok: true,
    message: `${index.length} file pronti per la ricerca.`,
  };
}

async function autoStartWatcher(args = {}) {
  const state = await loadState();
  const watchPaths = normalizeSetupPaths(args.paths, state.watchPaths || defaultWatchPaths());
  await startFileWatcher(watchPaths);
  state.watchPaths = watchPaths;
  state.watcherActive = true;
  state.watcherStartedAt = Date.now();
  state.watcherRoots = watcherRoots(watchPaths);
  state.watcherError = "";
  await saveState(state);
  return { ok: true, message: "Aggiornamenti automatici attivi." };
}

function componentState(component) {
  if (component.installed) return "ready";
  if (component.installable === false || component.manualAction) return "manual";
  return "missing";
}

async function exportDiagnosticLog(state) {
  const diagnostic = redactSecrets(await doctorStatus(state));
  await fs.writeFile(DIAGNOSTIC_LOG, JSON.stringify(diagnostic, null, 2));
  return {
    ok: true,
    path: DIAGNOSTIC_LOG,
    generatedAt: diagnostic.generatedAt,
    summary: diagnostic.summary,
  };
}

function sanitizePackagingStatus(status) {
  return {
    platform: status.platform,
    arch: status.arch,
    root: status.root,
    dataDir: status.dataDir,
    modelDir: status.modelDir,
    localApiPort: status.localApiPort,
    bundle: status.bundle,
    checks: status.checks,
    readyForCurrentPlatform: status.readyForCurrentPlatform,
  };
}

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/token|secret|apiKey|key/i.test(key)) return [key, item ? "redacted" : item];
    return [key, redactSecrets(item)];
  }));
}

async function permissionChecks(state) {
  const checks = [];
  const paths = [
    { id: "data-dir", label: "Directory dati Trova", path: DATA_DIR, write: true },
    { id: "model-dir", label: "Cache modelli locale", path: MODEL_DIR, write: true },
    ...((state.watchPaths || []).filter((item) => item.enabled && !item.isExcluded).slice(0, 8).map((item, index) => ({
      id: `watch:${index}`,
      label: `Cartella indicizzata: ${path.basename(item.path) || item.path}`,
      path: item.path,
      write: false,
    }))),
  ];
  for (const item of paths) {
    const readable = await canAccess(item.path, fsConstants.R_OK);
    const writable = item.write ? await canAccess(item.path, fsConstants.W_OK) : true;
    checks.push({
      id: `permission:${item.id}`,
      label: item.label,
      category: "Permessi",
      state: readable && writable ? "ready" : "missing",
      required: item.write,
      detail: `${item.path} · ${readable ? "lettura OK" : "lettura NO"}${item.write ? ` · ${writable ? "scrittura OK" : "scrittura NO"}` : ""}`,
      action: "manual",
      hint: item.write ? "Serve accesso in scrittura per cache, log e modelli." : "La cartella viene saltata se non leggibile.",
    });
  }
  return checks;
}

async function canAccess(target, mode) {
  try {
    await fs.access(target, mode);
    return true;
  } catch {
    return false;
  }
}

async function modelStatus(state) {
  const semantic = semanticStatus(state);
  const vision = localVisionStatus(state);
  const modelFiles = await listModelCacheFiles();
  return {
    cacheDir: MODEL_DIR,
    generatedAt: Date.now(),
    text: {
      primaryModel: TEXT_EMBEDDING_MODEL,
      fallbackModel: LEXICAL_EMBEDDING_MODEL,
      activeModel: semantic.model,
      ready: semantic.ready,
      runtimeReady: semantic.runtimeReady,
      embeddedChunks: semantic.embeddedChunks,
      totalChunks: semantic.totalChunks,
      fallback: semantic.fallback,
      error: semantic.error || "",
    },
    vision: vision.models || [],
    face: {
      model: FACE_FINGERPRINT_MODEL,
      embeddedAssets: vision.faceEmbeddedAssets,
      totalAssets: vision.totalAssets,
      ready: vision.faceEmbeddedAssets > 0 || vision.totalAssets === 0,
      optInUse: "Solo modalita Persona esplicita.",
    },
    cache: {
      files: modelFiles.length,
      bytes: modelFiles.reduce((total, item) => total + item.size, 0),
      sample: modelFiles.slice(0, 12),
    },
  };
}

async function listModelCacheFiles() {
  const out = [];
  const queue = [MODEL_DIR];
  while (queue.length && out.length < 300) {
    const current = queue.shift();
    const items = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const item of items) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) queue.push(full);
      else if (item.isFile()) {
        const stat = await fs.stat(full).catch(() => null);
        out.push({ path: full, size: stat?.size || 0 });
      }
    }
  }
  return out;
}

async function warmupLocalModels(args = {}) {
  const steps = [];
  const started = Date.now();
  try {
    const embedded = await embedTextLocal(String(args.text || "Trova indicizza documenti immagini audio video in locale"));
    steps.push({
      id: "text-embeddings",
      ok: embedded.ready,
      model: embedded.model,
      message: embedded.ready ? "Embedding testuale locale pronto." : "Embedding testuale non pronto.",
    });
  } catch (err) {
    steps.push({ id: "text-embeddings", ok: false, message: String(err?.message || err) });
  }
  return {
    ok: steps.every((step) => step.ok),
    durationMs: Date.now() - started,
    steps,
    models: await modelStatus(await loadState()),
  };
}

async function discoverApiKeys() {
  const nvidia = await discoverNvidiaApiKeys();
  return {
    geminiFound: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    geminiSource: process.env.GEMINI_API_KEY ? "ambiente GEMINI_API_KEY" : process.env.GOOGLE_API_KEY ? "ambiente GOOGLE_API_KEY" : "",
    nvidiaFound: nvidia.length > 0,
    nvidiaSource: nvidia[0]?.source || "",
    nvidiaSources: nvidia.map((item) => item.source),
    nvidiaKeyCount: nvidia.length,
    nvidiaModel: NVIDIA_CHAT_MODEL,
  };
}

async function nvidiaAiStatus() {
  const keys = await discoverNvidiaApiKeys();
  return {
    configured: keys.length > 0,
    keyCount: keys.length,
    sources: keys.map((item) => item.source),
    model: NVIDIA_CHAT_MODEL,
    endpoint: NVIDIA_CHAT_URL,
  };
}

async function discoverNvidiaApiKeys() {
  const found = [];
  for (const name of ["NVIDIA_API_KEY", "NVCF_API_KEY", "NVIDIA_NIM_API_KEY", "NGC_API_KEY", "NV_API_KEY"]) {
    const value = normalizeApiKey(process.env[name]);
    if (value) found.push({ key: value, source: `ambiente ${name}` });
  }
  for (const filePath of await nvidiaKeyCandidateFiles()) {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile() || stat.size > 5 * 1024 * 1024) continue;
    const text = await fs.readFile(filePath, "utf8").catch(() => "");
    for (const key of extractNvidiaKeys(text)) {
      found.push({ key, source: filePath });
    }
  }
  const byKey = new Map();
  for (const item of found) {
    if (!item.key || byKey.has(item.key)) continue;
    byKey.set(item.key, item);
  }
  return Array.from(byKey.values()).slice(0, 8);
}

async function nvidiaKeyCandidateFiles() {
  const roots = [
    path.join(os.homedir(), "Documenti", "Claude"),
    path.join(os.homedir(), "Documents", "Claude"),
    path.join(os.homedir(), ".claude"),
  ];
  const existingRoots = [];
  for (const root of roots) {
    const stat = await fs.stat(root).catch(() => null);
    if (stat?.isDirectory()) existingRoots.push(root);
  }
  if (!existingRoots.length) return [];
  const files = [];
  const projectRoots = existingRoots.filter((root) => path.basename(root) !== ".claude");
  const rg = projectRoots.length ? await commandCandidate("rg", ["--version"]) : null;
  if (rg) {
    try {
      const { stdout } = await execFile(rg.command, [
        ...rg.prefix,
        "-l",
        "--hidden",
        "--glob",
        "!node_modules",
        "--glob",
        "!target",
        "--glob",
        "!dist",
        "--glob",
        "!build",
        "--glob",
        "!**/.next/**",
        "--glob",
        "!**/.firebase/**",
        "--glob",
        "!history.jsonl",
        "--glob",
        "!*.log",
        "--glob",
        "!*.png",
        "--glob",
        "!*.jpg",
        "--glob",
        "!*.jpeg",
        "--glob",
        "!*.webp",
        "nvapi-|NVIDIA_API_KEY|NVCF_API_KEY|NVIDIA_NIM_API_KEY|NGC_API_KEY|integrate\\.api\\.nvidia",
        ...projectRoots,
      ], { timeout: 8000, maxBuffer: 700_000 });
      files.push(...stdout.split("\n").map((line) => line.trim()).filter(Boolean));
    } catch {
      // The bounded directory walk below keeps discovery usable if rg times out.
    }
  }
  for (const root of existingRoots) {
    files.push(...await walkKeyFiles(root, 500));
  }
  return Array.from(new Set(files)).slice(0, 500);
}

async function walkKeyFiles(root, limit) {
  const out = [];
  const queue = [{ dir: root, depth: 0 }];
  let visitedDirs = 0;
  while (queue.length && out.length < limit && visitedDirs < 2500) {
    const current = queue.shift();
    visitedDirs += 1;
    const items = await fs.readdir(current.dir, { withFileTypes: true }).catch(() => []);
    for (const item of items) {
      const full = path.join(current.dir, item.name);
      if (item.isDirectory()) {
        if (current.depth < 6 && !["node_modules", "target", ".git", "dist", "build", "logs", ".next", ".venv"].includes(item.name)) {
          queue.push({ dir: full, depth: current.depth + 1 });
        }
      } else if (item.isFile()) {
        const lowerName = item.name.toLowerCase();
        if (lowerName.includes("history") || lowerName.endsWith(".log")) continue;
        if (isLikelyKeyFile(lowerName, full)) out.push(full);
      }
      if (out.length >= limit) break;
    }
  }
  return out;
}

function isLikelyKeyFile(lowerName, fullPath) {
  if (lowerName.startsWith(".env") || lowerName.endsWith(".env")) return true;
  if (lowerName.includes("nvidia") || lowerName.includes("ngc") || lowerName.includes("nim")) return true;
  if (["config.json", "settings.json", "credentials.json", "secrets.json"].includes(lowerName)) return true;
  if (lowerName.includes("api-key") || lowerName.includes("apikey") || lowerName.includes("api_key")) return true;
  const extension = ext(fullPath);
  return ["env", "yaml", "yml"].includes(extension) && (lowerName.includes("config") || lowerName.includes("secret"));
}

function extractNvidiaKeys(text) {
  const keys = new Set();
  for (const match of String(text || "").matchAll(/nvapi-[A-Za-z0-9_-]{20,}/g)) {
    const key = normalizeApiKey(match[0]);
    if (key) keys.add(key);
  }
  const variable = /(?:NVIDIA_API_KEY|NVCF_API_KEY|NVIDIA_NIM_API_KEY|NGC_API_KEY|NV_API_KEY|NVIDIA_API_TOKEN)\s*[:=]\s*["']?([^"',\s}]+)/gi;
  for (const match of String(text || "").matchAll(variable)) {
    const key = normalizeApiKey(match[1]);
    if (key) keys.add(key);
  }
  return Array.from(keys);
}

function normalizeApiKey(value) {
  const clean = String(value || "").trim().replace(/^Bearer\s+/i, "").replace(/^["']|["']$/g, "").replace(/[),.;]+$/g, "");
  if (!clean || clean.length < 20) return "";
  if (/^(null|undefined|changeme|your[-_ ]?key)$/i.test(clean)) return "";
  if (!/^nvapi-[A-Za-z0-9_-]{20,}$/.test(clean)) return "";
  return clean;
}

async function localComponentsStatus(state) {
  const [desktopRuntime, tika, typesense, ffmpeg, ffprobe, poppler, tesseract, whisper, docker, rclone] = await Promise.all([
    desktopRuntimeComponent(),
    httpComponent("tika", "Apache Tika", "Documenti", "Estrae testo e metadata da PDF, Office, archivi e altri file.", "http://127.0.0.1:9998/tika", "Tika locale raggiungibile", "Avvia con Docker o con `npm run search:up`."),
    httpComponent("typesense", "Typesense", "Indice", "Tiene l'indice full-text/fuzzy locale e persistente.", "http://127.0.0.1:8108/health", "Typesense locale raggiungibile", "Avvia con Docker o con `npm run search:up`."),
    commandComponent("ffmpeg", "FFmpeg", "Media", "Genera keyframe video e prepara audio/video per l'indice.", "ffmpeg", ["-version"], "Installa FFmpeg nel sistema."),
    commandComponent("ffprobe", "FFprobe", "Media", "Legge durata, codec, bitrate, risoluzione e metadata audio/video.", "ffprobe", ["-version"], "Di solito arriva insieme a FFmpeg."),
    commandComponent("poppler", "Poppler / pdftoppm", "PDF", "Renderizza preview reali delle pagine PDF.", "pdftoppm", ["-v"], "Installa Poppler utilities."),
    commandComponent("tesseract", "Tesseract OCR", "OCR", "Legge testo dentro immagini e PDF scansionati durante l'indicizzazione.", "tesseract", ["--version"], "Installa Tesseract e language pack italiano."),
    firstAvailableCommandComponent("whisper", "Whisper locale", "Audio", "Trascrive automaticamente audio e parlato nei video senza cloud, con cache locale.", ["whisper-cli", "whisper.cpp", "whisper"], ["--help"], "Installa il comando locale `whisper`; i modelli vengono scaricati in cache al primo uso."),
    commandComponent("docker", "Docker", "Servizi", "Avvia Tika e Typesense locali come servizi isolati.", "docker", ["--version"], "Installa Docker Desktop/Engine oppure avvia servizi manualmente."),
    commandComponent("rclone", "Rclone", "Remote", "Sincronizza FTP, SFTP, SMB, WebDAV e cloud storage in cache locale indicizzabile.", "rclone", ["version"], "Installa Rclone o usa l'installazione locale in .trova/bin.", false),
  ]);
  const vision = localVisionStatus(state);
  const semantic = semanticStatus(state);
  const fingerprintReady = vision.totalAssets === 0 || vision.models?.some((model) => model.model === "trova-fingerprint-v1" && model.embeddedAssets > 0);
  return [
    desktopRuntime,
    tika,
    typesense,
    {
      id: "text-embeddings",
      label: "Embeddings testuali",
      category: "Semantica",
      description: "Crea vettori locali per chunk testuali, file simili, domande e chat con citazioni.",
      required: true,
      installed: semantic.embeddedChunks > 0,
      status: semantic.embeddedChunks > 0 ? "indicizzato" : "in attesa indice",
      version: `${semantic.embeddedChunks}/${semantic.totalChunks} chunk · ${semantic.model}`,
      installHint: "Avvia o ricrea l'indice: il modello locale viene scaricato in cache al primo uso.",
      installable: true,
      state: semantic.embeddedChunks > 0 ? "ready" : "missing",
      actionLabel: "Indicizza",
    },
    ffmpeg,
    ffprobe,
    poppler,
    {
      id: "vision-fingerprint",
      label: "Fingerprint visuale",
      category: "Vision",
      description: "Ricerca immagini subito disponibile con vettore locale leggero.",
      required: true,
      installed: fingerprintReady,
      status: fingerprintReady ? "pronto" : "in attesa di asset",
      version: `${vision.embeddedAssets}/${vision.totalAssets} asset`,
      installHint: "Indicizza immagini, PDF o video e premi Prepara vision.",
      installable: true,
      state: fingerprintReady ? "ready" : "missing",
      actionLabel: "Prepara vision",
    },
    {
      id: "vision-neural",
      label: "CLIP + DINOv3 + SigLIP2",
      category: "Vision",
      description: "Modelli neurali locali per somiglianza foto, schemi, PDF e keyframe.",
      required: false,
      installed: Boolean(vision.models?.some((model) => model.model !== "trova-fingerprint-v1" && model.embeddedAssets > 0)),
      status: "cache browser locale",
      version: vision.models?.filter((model) => model.model !== "trova-fingerprint-v1").map((model) => `${model.label} ${model.embeddedAssets}/${model.totalAssets}`).join(" · ") || "nessun asset",
      installHint: "Si scaricano dal browser quando premi Prepara vision, poi restano in cache locale.",
      installable: true,
      state: "manual",
      actionLabel: "Scarica modelli",
    },
    tesseract,
    whisper,
    rclone,
    docker,
  ];
}

async function httpComponent(id, label, category, description, url, installedStatus, installHint) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return {
      id,
      label,
      category,
      description,
      required: true,
      installed: response.ok,
      status: response.ok ? installedStatus : `HTTP ${response.status}`,
      version: response.ok ? "online" : "non raggiungibile",
      installHint,
      installable: true,
      state: response.ok ? "ready" : "missing",
      actionLabel: "Avvia servizio",
    };
  } catch {
    return {
      id,
      label,
      category,
      description,
      required: true,
      installed: false,
      status: "non raggiungibile",
      version: "offline",
      installHint,
      installable: true,
      state: "missing",
      actionLabel: "Avvia servizio",
    };
  }
}

async function commandComponent(id, label, category, description, binary, args, installHint, required = true) {
  const command = await commandCandidate(binary, args);
  if (!command) {
    return { id, label, category, description, required, installed: false, status: "manca", version: "non trovato", installHint, installable: true, state: "missing", actionLabel: "Installa" };
  }
  const version = await commandVersion(command.command, [...command.prefix, ...args]).catch(() => "installato");
  return { id, label, category, description, required, installed: true, status: "installato", version, installHint, installable: true, state: "ready", actionLabel: "Testa" };
}

async function commandCandidate(binary, args) {
  const onWindows = os.platform() === "win32";
  const candidates = [
    { command: path.join(BIN_DIR, binary), prefix: [] },
    { command: path.join(BIN_DIR, `${binary}.exe`), prefix: [] },
    { command: binary, prefix: [] },
    { command: "host-spawn", prefix: [binary] },
    { command: "flatpak-spawn", prefix: ["--host", binary] },
  ];
  for (const candidate of candidates) {
    try {
      // Su Windows i shim .cmd/.bat di npm/cargo/ecc richiedono shell:true per essere eseguiti.
      await execFile(candidate.command, [...candidate.prefix, ...args], {
        timeout: 4000,
        maxBuffer: 120_000,
        shell: onWindows && (candidate.command === binary || candidate.command.endsWith(binary)),
        windowsHide: true,
      });
      return candidate;
    } catch {
      // try next location
    }
  }
  return null;
}

async function rcloneCommand() {
  return commandCandidate("rclone", ["version"]);
}

async function firstAvailableCommandComponent(id, label, category, description, binaries, args, installHint) {
  for (const binary of binaries) {
    const component = await commandComponent(id, label, category, description, binary, args, installHint, false);
    if (component.installed) return { ...component, version: `${binary} · ${component.version}` };
  }
  return { id, label, category, description, required: false, installed: false, status: "manca", version: "non trovato", installHint, installable: true, state: "missing", actionLabel: "Installa" };
}

async function installLocalComponent(id) {
  if (id === "desktop-runtime") {
    const result = await bootstrapLocalRuntime();
    return {
      ok: result.ok,
      componentId: id,
      message: result.message,
      steps: result.steps,
      components: result.components,
    };
  }
  if (id === "rclone") return installRcloneLocal();
  const osInfo = await detectOsInfo();
  const plan = installPlanFor(id, osInfo);
  if (!plan) {
    throw new Error("Installazione automatica non disponibile per questo componente. Usa il suggerimento mostrato nella card.");
  }
  const steps = [];
  for (const step of plan.steps) {
    const started = Date.now();
    const result = await runInstallStep(step);
    steps.push({
      label: step.label,
      command: [step.command, ...step.args].join(" "),
      ok: result.ok,
      output: result.output,
      manualAction: Boolean(result.manualAction),
      durationMs: Date.now() - started,
    });
    if (!result.ok) {
      return {
        ok: false,
        componentId: id,
        message: `${step.label} non riuscito`,
        steps,
        components: await localComponentsStatus(await loadState()),
      };
    }
  }
  return {
    ok: true,
    componentId: id,
    message: plan.successMessage,
    steps,
    components: await localComponentsStatus(await loadState()),
  };
}

async function desktopRuntimeComponent() {
  const status = await packagingStatus();
  const node = status.tools.find((tool) => tool.id === "node");
  const tauri = status.tools.find((tool) => tool.id === "tauri-cli");
  const missing = status.checks.filter((check) => !check.ok).map((check) => check.label);
  return {
    id: "desktop-runtime",
    label: "Runtime desktop",
    category: "App",
    description: "Fa partire la stessa API locale completa dentro l'app Tauri, con indice e modelli fuori dal cloud.",
    required: true,
    installed: status.readyForCurrentPlatform,
    status: status.readyForCurrentPlatform ? "pronto" : "preflight incompleto",
    version: [
      node?.installed ? `Node ${node.version}` : "Node mancante",
      tauri?.installed ? "Tauri CLI pronta" : "Tauri CLI mancante",
    ].join(" · "),
    installHint: missing.length
      ? `Completa preflight: ${missing.slice(0, 3).join(", ")}.`
      : "Desktop pronto: in Tauri l'API locale viene avviata in background.",
    installable: true,
    state: status.readyForCurrentPlatform ? "ready" : "missing",
    actionLabel: "Preflight",
  };
}

async function bootstrapLocalRuntime() {
  await Promise.all([
    fs.mkdir(DATA_DIR, { recursive: true }),
    fs.mkdir(PREVIEW_DIR, { recursive: true }),
    fs.mkdir(KEYFRAME_DIR, { recursive: true }),
    fs.mkdir(TRANSCRIPT_DIR, { recursive: true }),
    fs.mkdir(OCR_DIR, { recursive: true }),
    fs.mkdir(MODEL_DIR, { recursive: true }),
    fs.mkdir(QUERY_DIR, { recursive: true }),
    fs.mkdir(REMOTE_DIR, { recursive: true }),
    fs.mkdir(BIN_DIR, { recursive: true }),
    fs.mkdir(RUNTIME_DIR, { recursive: true }),
  ]);
  const packaging = await packagingStatus();
  return {
    ok: packaging.readyForCurrentPlatform,
    message: packaging.readyForCurrentPlatform
      ? "Runtime locale pronto per app desktop."
      : "Runtime locale preparato, ma preflight packaging incompleto.",
    dataDir: DATA_DIR,
    modelDir: MODEL_DIR,
    steps: [
      {
        label: "Creo cartelle dati locali",
        command: `mkdir -p ${DATA_DIR}`,
        ok: true,
        output: DATA_DIR,
        durationMs: 0,
      },
      {
        label: "Controllo packaging desktop",
        command: "node scripts/trova-package.mjs preflight",
        ok: packaging.readyForCurrentPlatform,
        output: packaging.checks.map((check) => `${check.ok ? "OK" : "NO"} ${check.label}`).join("\n"),
        durationMs: 0,
      },
    ],
    packaging,
    components: await localComponentsStatus(await loadState()),
  };
}

async function packagingStatus() {
  const [node, npm, cargo, rustc] = await Promise.all([
    toolStatus("node", "Node.js", "node", ["--version"]),
    toolStatus("npm", "npm", "npm", ["--version"]),
    toolStatus("cargo", "Cargo", "cargo", ["--version"]),
    toolStatus("rustc", "Rust", "rustc", ["--version"]),
  ]);
  const tauriCliPath = path.join(ROOT, "node_modules", "@tauri-apps", "cli", "tauri.js");
  const tauriCliExists = await fileExists(tauriCliPath);
  const configPath = path.join(ROOT, "src-tauri", "tauri.conf.json");
  const tauriConfig = await readJson(configPath, {});
  const iconPaths = Array.isArray(tauriConfig?.bundle?.icon) ? tauriConfig.bundle.icon : [];
  const resourcePaths = Array.isArray(tauriConfig?.bundle?.resources) ? tauriConfig.bundle.resources : [];
  const resolvedIconOk = (await Promise.all(
    iconPaths.map((item) => fileExists(path.resolve(ROOT, "src-tauri", item))),
  )).some(Boolean);
  const localApiScript = path.join(ROOT, "scripts", "local-backend.mjs");
  const localApiScriptOk = await fileExists(localApiScript);
  const buildOutputOk = await fileExists(path.join(ROOT, "dist", "index.html"));
  const checks = [
    { id: "node", label: "Node.js disponibile per API locale", ok: node.installed, detail: node.version || node.error },
    { id: "npm", label: "npm disponibile per build/preflight", ok: npm.installed, detail: npm.version || npm.error },
    { id: "cargo", label: "Cargo disponibile per Tauri", ok: cargo.installed, detail: cargo.version || cargo.error },
    { id: "rustc", label: "Rust disponibile", ok: rustc.installed, detail: rustc.version || rustc.error },
    { id: "tauri-cli", label: "Tauri CLI installata nel progetto", ok: tauriCliExists, detail: tauriCliPath },
    { id: "local-api", label: "Backend locale completo incluso", ok: localApiScriptOk, detail: localApiScript },
    { id: "icon", label: "Icona app configurata", ok: resolvedIconOk, detail: iconPaths.join(", ") || "nessuna icona" },
    { id: "resources", label: "Risorse backend dichiarate nel bundle", ok: resourcePaths.some((item) => String(item).includes("local-backend")), detail: resourcePaths.join(", ") || "nessuna risorsa" },
  ];
  const bundleArgs = desktopBundleArgs();
  return {
    platform: os.platform(),
    arch: os.arch(),
    root: ROOT,
    dataDir: DATA_DIR,
    modelDir: MODEL_DIR,
    localApiPort: PORT,
    localApiScript,
    bundle: {
      productName: tauriConfig.productName || "Trova",
      version: tauriConfig.version || "0.0.0",
      identifier: tauriConfig.identifier || "",
      targets: tauriConfig?.bundle?.targets || "all",
      icons: iconPaths,
      resources: resourcePaths,
      defaultBundles: bundleArgs.slice(2).join(","),
      frontendBuilt: buildOutputOk,
    },
    tools: [
      node,
      npm,
      cargo,
      rustc,
      {
        id: "tauri-cli",
        label: "Tauri CLI",
        binary: tauriCliPath,
        installed: tauriCliExists,
        version: tauriCliExists ? "project dependency" : "",
        error: tauriCliExists ? "" : "node_modules/@tauri-apps/cli non trovato",
      },
    ],
    checks,
    readyForCurrentPlatform: checks.every((check) => check.ok),
    commands: [
      { label: "Preflight", command: "npm", args: ["run", "package:preflight"] },
      { label: "Build web", command: "npm", args: ["run", "build"] },
      { label: "Bundle desktop", command: "npm", args: ["run", "tauri", "--", ...bundleArgs] },
    ],
  };
}

function desktopBundleArgs() {
  if (os.platform() === "linux") return ["build", "--bundles", "deb,rpm"];
  return ["build"];
}

async function toolStatus(id, label, binary, args) {
  const candidate = await commandCandidate(binary, args);
  if (!candidate) {
    return { id, label, binary, installed: false, version: "", error: `${binary} non trovato` };
  }
  const version = await commandVersion(candidate.command, [...candidate.prefix, ...args]).catch((err) => String(err?.message || err));
  return {
    id,
    label,
    binary: [candidate.command, ...candidate.prefix].join(" "),
    installed: true,
    version,
    error: "",
  };
}

async function fileExists(filePath) {
  return fs.stat(filePath).then((stat) => stat.isFile()).catch(() => false);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function runInstallStep(step) {
  try {
    let command = step.command;
    let args = step.args;
    if (command === "sudo" && process.getuid?.() !== 0) {
      const sudoOk = await canRunPasswordlessSudo();
      if (!sudoOk) {
        return {
          ok: false,
          manualAction: true,
          output: `Azione manuale richiesta: esegui nel terminale\nsudo ${args.join(" ")}\n\nTrova non apre prompt password nascosti dentro l'app.`,
        };
      }
      args = ["-n", ...args];
    }
    const { stdout, stderr } = await execFile(command, args, {
      timeout: step.timeoutMs ?? 600_000,
      maxBuffer: 2_000_000,
      env: { ...process.env, DNF_YES: "1" },
    });
    return { ok: true, output: trimInstallOutput(`${stdout || ""}\n${stderr || ""}`) };
  } catch (err) {
    return { ok: false, output: trimInstallOutput(`${err.stdout || ""}\n${err.stderr || ""}\n${err.message || err}`) };
  }
}

async function canRunPasswordlessSudo() {
  try {
    await execFile("sudo", ["-n", "true"], { timeout: 3000, maxBuffer: 40_000 });
    return true;
  } catch {
    return false;
  }
}

async function installRcloneLocal() {
  const started = Date.now();
  const platform = os.platform();
  const arch = os.arch();
  const target = rcloneDownloadTarget(platform, arch);
  if (!target) {
    throw new Error(`Installazione Rclone locale non supportata automaticamente per ${platform}/${arch}.`);
  }
  const installRoot = path.join(DATA_DIR, "install", `rclone-${Date.now()}`);
  const zipPath = path.join(installRoot, "rclone.zip");
  const extractDir = path.join(installRoot, "extract");
  await fs.mkdir(extractDir, { recursive: true });
  const response = await fetch(target.url);
  if (!response.ok) throw new Error(`Download Rclone fallito: HTTP ${response.status}`);
  await fs.writeFile(zipPath, Buffer.from(await response.arrayBuffer()));
  await extractZip(zipPath, extractDir);
  const binary = await findFileByName(extractDir, target.binary);
  if (!binary) throw new Error("Archivio Rclone scaricato, ma binario non trovato.");
  const destination = path.join(BIN_DIR, target.binary);
  await fs.copyFile(binary, destination);
  await fs.chmod(destination, 0o755).catch(() => {});
  const version = await commandVersion(destination, ["version"]).catch(() => "installato");
  return {
    ok: true,
    componentId: "rclone",
    message: `Rclone installato localmente in ${destination}`,
    steps: [{
      label: "Download e installazione locale Rclone",
      command: target.url,
      ok: true,
      output: version,
      durationMs: Date.now() - started,
    }],
    components: await localComponentsStatus(await loadState()),
  };
}

function rcloneDownloadTarget(platform, arch) {
  const normalizedArch = arch === "x64" ? "amd64" : arch === "arm64" ? "arm64" : "";
  if (!normalizedArch) return null;
  const platformName = platform === "linux"
    ? "linux"
    : platform === "darwin"
      ? "osx"
      : platform === "win32"
        ? "windows"
        : "";
  if (!platformName) return null;
  return {
    url: `https://downloads.rclone.org/rclone-current-${platformName}-${normalizedArch}.zip`,
    binary: platform === "win32" ? "rclone.exe" : "rclone",
  };
}

async function extractZip(zipPath, extractDir) {
  const python = await commandCandidate("python3", ["--version"]) || await commandCandidate("python", ["--version"]);
  if (python) {
    await execFile(python.command, [...python.prefix, "-m", "zipfile", "-e", zipPath, extractDir], {
      timeout: 120_000,
      maxBuffer: 500_000,
    });
    return;
  }
  const unzip = await commandCandidate("unzip", ["-v"]);
  if (!unzip) throw new Error("Serve python3 o unzip per estrarre Rclone.");
  await execFile(unzip.command, [...unzip.prefix, "-q", zipPath, "-d", extractDir], {
    timeout: 120_000,
    maxBuffer: 500_000,
  });
}

async function findFileByName(root, fileName) {
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    const items = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const item of items) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) queue.push(full);
      else if (item.isFile() && item.name === fileName) return full;
    }
  }
  return "";
}

function installPlanFor(id, osInfo) {
  const linux = os.platform() === "linux";
  const isFedoraLike = linux && ["fedora", "rhel", "centos"].some((name) => osInfo.idLike.includes(name) || osInfo.id === name);
  const isDebianLike = linux && ["debian", "ubuntu", "linuxmint", "pop"].some((name) => osInfo.idLike.includes(name) || osInfo.id === name);
  if (id === "tika" || id === "typesense") {
    return servicePlan(id, "Tika e Typesense avviati con Docker Compose.");
  }
  if (isFedoraLike) {
    if (id === "tesseract") return dnfPlan(id, ["tesseract", "tesseract-langpack-ita"], "Tesseract OCR e lingua italiana installati.");
    if (id === "whisper") return uvToolPlan(id, "openai-whisper", "Whisper locale installato come comando `whisper`.");
    if (id === "ffmpeg" || id === "ffprobe") return dnfPlan(id, ["ffmpeg"], "FFmpeg e FFprobe installati.");
    if (id === "poppler") return dnfPlan(id, ["poppler-utils"], "Poppler utilities installate.");
  }
  if (isDebianLike) {
    if (id === "tesseract") return aptPlan(id, ["tesseract-ocr", "tesseract-ocr-ita"], "Tesseract OCR e lingua italiana installati.");
    if (id === "ffmpeg" || id === "ffprobe") return aptPlan(id, ["ffmpeg"], "FFmpeg e FFprobe installati.");
    if (id === "poppler") return aptPlan(id, ["poppler-utils"], "Poppler utilities installate.");
  }
  if (os.platform() === "darwin") {
    if (id === "tesseract") return brewPlan(id, ["tesseract", "tesseract-lang"], "Tesseract OCR installato.");
    if (id === "whisper") return uvToolPlan(id, "openai-whisper", "Whisper locale installato come comando `whisper`.");
    if (id === "ffmpeg" || id === "ffprobe") return brewPlan(id, ["ffmpeg"], "FFmpeg e FFprobe installati.");
    if (id === "poppler") return brewPlan(id, ["poppler"], "Poppler utilities installate.");
  }
  if (os.platform() === "win32") {
    if (id === "ffmpeg" || id === "ffprobe") return wingetPlan(id, ["Gyan.FFmpeg"], "FFmpeg e FFprobe installati.");
    if (id === "tesseract") return wingetPlan(id, ["UB-Mannheim.TesseractOCR"], "Tesseract OCR installato.");
    if (id === "poppler") return manualPlan(id, "Installa Poppler per Windows e aggiungi `pdftoppm` al PATH.");
  }
  if (id === "whisper") return uvToolPlan(id, "openai-whisper", "Whisper locale installato come comando `whisper`.");
  return null;
}

function servicePlan(id, successMessage) {
  return {
    id,
    successMessage,
    steps: [
      { label: "Avvio Tika e Typesense locali", command: "node", args: ["scripts/search-service.mjs", "up"], timeoutMs: 240_000 },
    ],
  };
}

function wingetPlan(id, packages, successMessage) {
  return {
    id,
    successMessage,
    steps: packages.map((pkg) => ({
      label: `Installo ${pkg} con winget`,
      command: "winget",
      args: ["install", "--accept-source-agreements", "--accept-package-agreements", "--id", pkg],
      timeoutMs: 900_000,
    })),
  };
}

function manualPlan(id, message) {
  return {
    id,
    successMessage: message,
    steps: [
      { label: "Azione manuale", command: process.execPath, args: ["-e", `console.log(${JSON.stringify(message)})`] },
    ],
  };
}

function dnfPlan(id, packages, successMessage) {
  return {
    id,
    successMessage,
    steps: [
      { label: `Installo ${packages.join(", ")} con dnf`, command: "sudo", args: ["dnf", "install", "-y", ...packages] },
    ],
  };
}

function aptPlan(id, packages, successMessage) {
  return {
    id,
    successMessage,
    steps: [
      { label: "Aggiorno elenco pacchetti", command: "sudo", args: ["apt-get", "update"] },
      { label: `Installo ${packages.join(", ")} con apt`, command: "sudo", args: ["apt-get", "install", "-y", ...packages] },
    ],
  };
}

function brewPlan(id, packages, successMessage) {
  return {
    id,
    successMessage,
    steps: [
      { label: `Installo ${packages.join(", ")} con Homebrew`, command: "brew", args: ["install", ...packages] },
    ],
  };
}

function uvToolPlan(id, tool, successMessage) {
  return {
    id,
    successMessage,
    steps: [
      { label: `Installo ${tool} con uv`, command: "uv", args: ["tool", "install", tool], timeoutMs: 900_000 },
    ],
  };
}

async function detectOsInfo() {
  if (os.platform() !== "linux") return { id: os.platform(), idLike: "" };
  try {
    const content = await fs.readFile("/etc/os-release", "utf8");
    const fields = Object.fromEntries(
      content.split("\n")
        .map((line) => line.match(/^([A-Z_]+)=(.*)$/))
        .filter(Boolean)
        .map((match) => [match[1].toLowerCase(), match[2].replace(/^"|"$/g, "").toLowerCase()]),
    );
    return { id: fields.id || "linux", idLike: fields.id_like || "" };
  } catch {
    return { id: "linux", idLike: "" };
  }
}

function trimInstallOutput(output) {
  const clean = output.replace(/\r/g, "").trim();
  if (clean.length <= 1800) return clean;
  return `${clean.slice(0, 700)}\n...\n${clean.slice(-900)}`;
}

async function commandVersion(command, args) {
  const onWindows = os.platform() === "win32";
  // shell:true serve su Windows quando `command` e un binary risolto via PATH (es. npm.cmd)
  // e non un percorso assoluto a .exe.
  const looksLikeShim = onWindows && !path.isAbsolute(command) && !command.toLowerCase().endsWith(".exe");
  const { stdout, stderr } = await execFile(command, args, {
    timeout: 4000,
    maxBuffer: 120_000,
    shell: looksLikeShim,
    windowsHide: true,
  });
  const line = `${stdout || stderr}`.split("\n").find(Boolean) || "installato";
  return line.length > 96 ? `${line.slice(0, 93)}...` : line;
}

function visualEmbeddingModels(asset) {
  const models = new Set();
  if (asset.embeddingModel) models.add(asset.embeddingModel);
  for (const embedding of asset.visualEmbeddings || []) {
    if (embedding.model) models.add(embedding.model);
  }
  return Array.from(models);
}

function visualAssetId(asset) {
  return hash(`${asset.filePath}:${asset.pageNumber || 0}:${asset.assetKind}:${asset.thumbnailPath || ""}`).slice(0, 24);
}

function indexStatus(state) {
  const count = state.index?.length || 0;
  const stats = state.lastIndexStats || {};
  const semantic = semanticStatus(state);
  const connectors = state.connectors || [];
  return {
    running: false,
    phase: "idle",
    filesDiscovered: stats.filesDiscovered ?? count,
    filesIndexed: count,
    filesSkipped: stats.filesSkipped ?? 0,
    progress: count ? 100 : 0,
    watcherActive: Boolean(state.watcherActive),
    watcherQueued: watcherQueue.size || state.watcherQueued || 0,
    watcherBusy,
    watcherProcessed: state.watcherProcessed || 0,
    watcherRoots: state.watcherRoots || watcherRoots(state.watchPaths || []),
    watcherError: state.watcherError || "",
    lastWatcherEvent: state.lastWatcherEvent || null,
    lastIndexedAt: state.lastIndexedAt || null,
    indexSizeBytes: JSON.stringify(state.index || []).length,
    tikaAvailable: true,
    typesenseAvailable: !lastTypesenseError,
    typesenseError: lastTypesenseError,
    semanticReady: semantic.ready,
    semanticChunks: semantic.embeddedChunks,
    semanticModel: semantic.model,
    remoteConnectors: connectors.length,
    remoteEnabled: connectors.filter((item) => item.enabled).length,
    remoteSynced: connectors.filter((item) => item.lastSyncAt && !item.lastSyncError).length,
    remoteErrors: connectors.filter((item) => item.lastSyncError).length,
  };
}

async function loadState() {
  try {
    const state = JSON.parse(await fs.readFile(STATE_PATH, "utf8"));
    state.watchPaths = (state.watchPaths || defaultWatchPaths()).map((item) => ({
      sourceType: "local",
      autoIndex: true,
      recursive: true,
      geminiEnabled: false,
      isExcluded: false,
      enabled: true,
      ...item,
    }));
    state.connectors = normalizeConnectors(state.connectors || []);
    return state;
  } catch {
    return { watchPaths: defaultWatchPaths(), connectors: [], index: [] };
  }
}

async function saveState(state) {
  await fs.writeFile(STATE_PATH, JSON.stringify(state));
}

function defaultWatchPaths() {
  const home = os.homedir();
  const paths = [];
  const seen = new Set();
  for (const folder of ["Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos"]) {
    pushDefaultWatchPath(paths, seen, path.join(home, folder), true);
  }
  pushDefaultWatchPath(paths, seen, home, true);
  for (const root of probableRoots()) {
    pushDefaultWatchPath(paths, seen, root, false);
  }
  return paths;
}

function probableRoots() {
  if (process.platform === "win32") {
    return "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => `${letter}:\\`);
  }
  if (process.platform === "darwin") return ["/Volumes"];
  return ["/mnt", "/media"];
}

function pushDefaultWatchPath(paths, seen, folderPath, enabled) {
  if (!existsSync(folderPath) || seen.has(folderPath)) return;
  seen.add(folderPath);
  paths.push(watchPath(folderPath, enabled));
}

function upgradeDefaultWatchPaths(state) {
  if (state.defaultPathsUpgraded) return { changed: false };
  const current = state.watchPaths || [];
  const seen = new Set(current.map((item) => normalizeFilePath(item.path)));
  for (const item of defaultWatchPaths()) {
    const normalized = normalizeFilePath(item.path);
    if (seen.has(normalized)) continue;
    current.push(item);
    seen.add(normalized);
  }
  state.watchPaths = current;
  state.defaultPathsUpgraded = true;
  return { changed: true };
}

function watchPath(folderPath, enabled) {
  return {
    id: hash(folderPath).slice(0, 16),
    path: folderPath,
    enabled,
    recursive: true,
    isExcluded: false,
    geminiEnabled: false,
    autoIndex: true,
    sourceType: "local",
  };
}

function matchesFilter(kind, filters) {
  if (!filters.length || filters.includes("all")) return true;
  if (filters.includes("text")) return kind === "document" || kind === "code";
  if (filters.includes("images")) return kind === "image";
  if (filters.includes("documents")) return kind === "document";
  return filters.includes(kind);
}

function classify(extension) {
  if (IMAGE_EXT.has(extension)) return "image";
  if (AUDIO_EXT.has(extension)) return "audio";
  if (VIDEO_EXT.has(extension)) return "video";
  if (CODE_EXT.has(extension)) return "code";
  if (DOC_EXT.has(extension)) return "document";
  return "other";
}

function ext(filePath) {
  return path.extname(filePath).replace(".", "").toLowerCase();
}

function fileFingerprint(filePath, stat) {
  return hash(`${normalizeFilePath(filePath)}:${stat.size}:${stat.mtimeMs}`);
}

async function fileMtimeSignature(filePath) {
  const stat = await fs.stat(filePath);
  return `${stat.size}:${stat.mtimeMs}`;
}

function normalizeFilePath(filePath) {
  return path.resolve(String(filePath || ""));
}

function isInsidePath(filePath, rootPath) {
  const normalizedFile = normalizeFilePath(filePath);
  const normalizedRoot = normalizeFilePath(rootPath);
  return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}${path.sep}`);
}

function mime(extension) {
  if (extension === "pdf") return "application/pdf";
  if (extension === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (extension === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (extension === "pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "mp4") return "video/mp4";
  if (extension === "mov") return "video/quicktime";
  if (extension === "webm") return "video/webm";
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "wav") return "audio/wav";
  if (extension === "ogg") return "audio/ogg";
  if (extension === "flac") return "audio/flac";
  if (["txt", "md", "csv", "json", "toml", "yaml", "yml", "html", "css", "js", "jsx", "ts", "tsx", "py", "rs", "go", "java", "c", "cpp", "h"].includes(extension)) {
    return "text/plain";
  }
  return "application/octet-stream";
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function mediaCommand(binary) {
  const candidates = [
    { command: path.join(BIN_DIR, binary), prefix: [] },
    { command: path.join(BIN_DIR, `${binary}.exe`), prefix: [] },
    { command: binary, prefix: [] },
    { command: "host-spawn", prefix: [binary] },
    { command: "flatpak-spawn", prefix: ["--host", binary] },
  ];
  for (const candidate of candidates) {
    if (await commandWorks(candidate.command, candidate.prefix)) return candidate;
  }
  return null;
}

async function commandWorks(command, prefix = []) {
  try {
    await execFile(command, [...prefix, "-version"], { timeout: 4000, maxBuffer: 200_000 });
    return true;
  } catch {
    return false;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8_000_000) req.destroy();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, x-trova-token");
}

function endJson(res, payload, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}
