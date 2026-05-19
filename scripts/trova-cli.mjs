#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const API_URL = process.env.TROVA_LOCAL_API_URL || "http://127.0.0.1:17654/api/command";
const execFile = promisify(execFileCallback);

const args = process.argv.slice(2);
const command = args.shift();
const options = parseOptions(args);

try {
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else if (command === "status") {
    const [status, semantic, vision] = await Promise.all([
      api("get_index_status", {}),
      api("get_semantic_status", {}),
      api("get_local_vision_status", {}),
    ]);
    output({ status, semantic, vision }, formatStatus);
  } else if (command === "simple-status" || command === "stato-app") {
    output(await api("get_simple_app_status", {}), formatSimpleStatus);
  } else if (command === "setup" || command === "install-everything") {
    const paths = options.positionals.length ? options.positionals.map((item) => watchPath(path.resolve(item))) : undefined;
    const job = await api(command === "install-everything" ? "install_everything" : "start_auto_setup", {
      paths,
      allowSystemChanges: !options.noSystemChanges,
    });
    output(options.wait ? await waitForSetup(job.id) : job, formatAutoSetupJob);
  } else if (command === "repair") {
    const job = await api("repair_app", { allowSystemChanges: !options.noSystemChanges });
    output(options.wait ? await waitForSetup(job.id) : job, formatAutoSetupJob);
  } else if (command === "doctor") {
    const action = options.positionals[0] || "status";
    if (action === "export") output(await api("export_diagnostic_log", {}), formatDoctorExport);
    else output(await api("get_doctor_status", {}), formatDoctorStatus);
  } else if (command === "install-component") {
    const id = options.positionals[0];
    if (!id) throw new Error("Uso: trova install-component tesseract|whisper|ffmpeg|poppler|rclone|tika|typesense");
    output(await api("install_local_component", { id }), formatInstallComponent);
  } else if (command === "model-status") {
    output(await api("get_model_status", {}), formatModelStatus);
  } else if (command === "index") {
    const paths = options.positionals.length
      ? options.positionals.map((item) => watchPath(path.resolve(item)))
      : await api("load_watch_paths", {});
    const status = await api("start_indexing", { paths });
    output(status, formatStatusOnly);
  } else if (command === "watch") {
    const action = options.positionals[0] || "start";
    if (action === "stop") {
      output(await api("stop_watcher", {}), formatStatusOnly);
    } else {
      const paths = options.positionals.slice(action === "start" ? 1 : 0).length
        ? options.positionals.slice(action === "start" ? 1 : 0).map((item) => watchPath(path.resolve(item)))
        : await api("load_watch_paths", {});
      output(await api("start_watcher", { paths }), formatStatusOnly);
    }
  } else if (command === "search") {
    const query = options.positionals.join(" ").trim();
    if (!query) throw new Error("Uso: trova search \"query\"");
    const results = await api("search_index", {
      request: {
        textQuery: query,
        mode: "text",
        filters: filtersOption(options),
        semantic: true,
        fuzzy: true,
        limit: limitOption(options, 20),
        useLocal: true,
        useGemini: false,
      },
    });
    output(results.slice(0, limitOption(options, 20)), formatResults);
  } else if (command === "image-search") {
    const imagePath = options.positionals[0];
    if (!imagePath) throw new Error("Uso: trova image-search path/to/query.png");
    const vector = await imageEmbedding(imagePath);
    const faceVector = options.person ? await faceEmbedding(imagePath).catch(() => []) : [];
    const results = await api("search_index", {
      request: {
        imageQuery: vector,
        imageQueries: [vector],
        faceQuery: faceVector,
        faceQueries: faceVector.length ? [faceVector] : [],
        mode: options.person ? "person" : "image",
        filters: filtersOption(options),
        limit: limitOption(options, 20),
        useLocal: true,
        useGemini: false,
      },
    });
    output(results.slice(0, limitOption(options, 20)), formatResults);
  } else if (command === "ask") {
    const question = options.positionals.join(" ").trim();
    if (!question) throw new Error("Uso: trova ask \"domanda\"");
    const answer = await api("ask_files", {
      request: {
        question,
        filters: filtersOption(options),
        limit: limitOption(options, 6),
      },
    });
    output(answer, formatAnswer);
  } else if (command === "similar") {
    const textQuery = options.positionals.join(" ").trim();
    if (!textQuery && !options.file) throw new Error("Uso: trova similar \"testo\" oppure trova similar --file /path/file");
    const results = await api("find_similar_files", {
      request: {
        textQuery,
        filePath: options.file,
        filters: filtersOption(options),
        limit: limitOption(options, 20),
      },
    });
    output(results.slice(0, limitOption(options, 20)), formatResults);
  } else if (command === "context") {
    const filePath = options.positionals[0] || options.file;
    if (!filePath) throw new Error("Uso: trova context /path/file");
    output(await api("get_file_context", { request: { filePath, maxChars: Number(options.maxChars || 5000) } }), formatContext);
  } else if (command === "remotes") {
    await handleRemotesCommand(options);
  } else if (command === "remote-access") {
    await handleRemoteAccessCommand(options);
  } else if (command === "package" || command === "packaging") {
    await handlePackagingCommand(options);
  } else if (command === "release") {
    await handleReleaseCommand(options);
  } else {
    throw new Error(`Comando non riconosciuto: ${command}`);
  }
} catch (err) {
  console.error(`Errore: ${err.message || err}`);
  process.exit(1);
}

function parseOptions(values) {
  const out = { positionals: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--json") out.json = true;
    else if (value === "--person") out.person = true;
    else if (value === "--appimage") out.appimage = true;
    else if (value === "--require-signing") out.requireSigning = true;
    else if (value === "--limit") out.limit = values[++index];
    else if (value === "--filter" || value === "--filters") out.filters = values[++index];
    else if (value === "--file") out.file = values[++index];
    else if (value === "--max-chars") out.maxChars = values[++index];
    else if (value === "--provider") out.provider = values[++index];
    else if (value === "--name") out.name = values[++index];
    else if (value === "--remote-name") out.remoteName = values[++index];
    else if (value === "--remote-path") out.remotePath = values[++index];
    else if (value === "--bind") out.bind = values[++index];
    else if (value === "--port") out.port = values[++index];
    else if (value === "--no-download") out.noDownload = true;
    else if (value === "--no-system-changes") out.noSystemChanges = true;
    else if (value === "--wait") out.wait = true;
    else if (value === "--enabled") out.enabled = true;
    else if (value === "--cloud") out.cloud = true;
    else if (value === "--no-auto-sync") out.noAutoSync = true;
    else out.positionals.push(value);
  }
  return out;
}

async function handleRemotesCommand(opts) {
  const action = opts.positionals.shift() || "list";
  if (action === "status") {
    output(await api("get_rclone_status", {}), formatRcloneStatus);
    return;
  }
  if (action === "list") {
    output(await api("get_connectors", {}), formatConnectors);
    return;
  }
  if (action === "add-local") {
    const source = opts.positionals[0] || opts.remotePath;
    if (!source) throw new Error("Uso: trova remotes add-local /cartella --name Nome");
    const current = await api("get_connectors", {});
    const connector = {
      id: String(Math.abs(hashCode(`${opts.name || source}:${source}`))),
      name: opts.name || path.basename(path.resolve(source)) || "Remote locale",
      provider: "local",
      remotePath: path.resolve(source),
      enabled: true,
      readOnly: true,
      autoSync: !opts.noAutoSync,
      geminiEnabled: Boolean(opts.cloud),
      syncMode: "cache",
    };
    output(await api("save_connectors", { connectors: upsertById(current, connector) }), formatConnectorSave);
    return;
  }
  if (action === "add-rclone") {
    const remoteName = opts.remoteName || opts.positionals[0];
    if (!remoteName) throw new Error("Uso: trova remotes add-rclone remoteName --provider drive --remote-path cartella");
    const current = await api("get_connectors", {});
    const connector = {
      id: String(Math.abs(hashCode(`${remoteName}:${opts.remotePath || ""}`))),
      name: opts.name || remoteName,
      provider: opts.provider || "drive",
      remoteName,
      remotePath: opts.remotePath || "",
      enabled: true,
      readOnly: true,
      autoSync: !opts.noAutoSync,
      geminiEnabled: Boolean(opts.cloud),
      syncMode: "cache",
    };
    output(await api("save_connectors", { connectors: upsertById(current, connector) }), formatConnectorSave);
    return;
  }
  if (action === "test") {
    const id = opts.positionals[0];
    if (!id) throw new Error("Uso: trova remotes test connectorId");
    output(await api("test_remote_connector", { id }), formatRemoteTest);
    return;
  }
  if (action === "sync") {
    const id = opts.positionals[0];
    if (!id) throw new Error("Uso: trova remotes sync connectorId");
    output(await api("sync_remote_connector", { id }), formatRemoteSync);
    return;
  }
  if (action === "sync-all") {
    output(await api("sync_all_remotes", {}), formatRemoteSyncAll);
    return;
  }
  throw new Error(`Azione remotes non riconosciuta: ${action}`);
}

async function handlePackagingCommand(opts) {
  const action = opts.positionals.shift() || "status";
  if (action === "status" || action === "preflight") {
    output(await api("get_packaging_status", {}), formatPackagingStatus);
    return;
  }
  if (action === "bootstrap") {
    output(await api("bootstrap_local_runtime", {}), formatRuntimeBootstrap);
    return;
  }
  throw new Error(`Azione packaging non riconosciuta: ${action}`);
}

async function handleRemoteAccessCommand(opts) {
  const action = opts.positionals.shift() || "status";
  if (action === "status") {
    output(await api("get_remote_access_status", {}), formatRemoteAccessStatus);
    return;
  }
  if (action === "start") {
    output(await api("start_remote_access", {
      config: {
        bind: opts.bind,
        port: opts.port ? Number(opts.port) : undefined,
        allowFileDownload: opts.noDownload ? false : undefined,
      },
    }), formatRemoteAccessStatus);
    return;
  }
  if (action === "stop") {
    output(await api("stop_remote_access", {}), formatRemoteAccessStatus);
    return;
  }
  if (action === "configure") {
    output(await api("configure_remote_access", {
      config: {
        bind: opts.bind,
        port: opts.port ? Number(opts.port) : undefined,
        allowFileDownload: opts.noDownload ? false : undefined,
        enabled: Boolean(opts.enabled),
      },
    }), formatRemoteAccessStatus);
    return;
  }
  throw new Error(`Azione remote-access non riconosciuta: ${action}`);
}

async function handleReleaseCommand(opts) {
  const action = opts.positionals.shift() || "status";
  const args = ["scripts/trova-release.mjs", action];
  if (opts.json) args.push("--json");
  if (opts.appimage) args.push("--appimage");
  if (opts.requireSigning) args.push("--require-signing");
  const { stdout } = await execFile("node", args, {
    cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."),
    timeout: action === "build" ? 1_800_000 : 60_000,
    maxBuffer: 5_000_000,
  });
  console.log(stdout.trim());
}

async function imageEmbedding(filePath) {
  const resolved = path.resolve(filePath);
  const bytes = await fs.readFile(resolved);
  const dataUrl = `data:${mimeFromPath(resolved)};base64,${bytes.toString("base64")}`;
  const vector = await api("visual_embedding_from_data_url", { dataUrl });
  if (!Array.isArray(vector) || !vector.length) throw new Error("Embedding immagine non generato.");
  return vector;
}

async function faceEmbedding(filePath) {
  const resolved = path.resolve(filePath);
  const bytes = await fs.readFile(resolved);
  const dataUrl = `data:${mimeFromPath(resolved)};base64,${bytes.toString("base64")}`;
  const vector = await api("face_embedding_from_data_url", { dataUrl });
  if (!Array.isArray(vector) || !vector.length) throw new Error("Embedding persona non generato.");
  return vector;
}

async function api(commandName, args) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: commandName, args }),
  }).catch((err) => {
    throw new Error(`local API non raggiungibile su ${API_URL}. Avvia: npm run local-api. ${err.message || err}`);
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `${commandName} fallito`);
  return payload.result;
}

function output(value, formatter) {
  if (options.json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(formatter(value));
}

async function waitForSetup(id) {
  for (let attempt = 0; attempt < 360; attempt += 1) {
    const job = await api("get_auto_setup_status", {});
    if (job.id === id && job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Preparazione ancora in corso.");
}

function formatSimpleStatus(status) {
  const issues = (status.issues || []).slice(0, 8).map((issue) => `- ${issue.title}: ${issue.message} [${issue.actionLabel}]`);
  return [
    `${status.title}: ${status.message}`,
    `Progresso: ${Math.round(status.progress || 0)}%`,
    issues.length ? `Da sistemare:\n${issues.join("\n")}` : "Da sistemare: nulla",
  ].join("\n");
}

function formatAutoSetupJob(job) {
  const steps = (job.steps || []).map((step) => `- ${step.label}: ${step.state}`);
  return [
    `${job.title} · ${job.status} · ${Math.round(job.progress || 0)}%`,
    job.message || "",
    steps.length ? steps.join("\n") : "",
  ].filter(Boolean).join("\n");
}

function formatStatus({ status, semantic, vision }) {
  return [
    formatStatusOnly(status),
    `Semantica: ${semantic.embeddedChunks}/${semantic.totalChunks} chunk · ${shortModel(semantic.model)}`,
    `Vision: ${vision.embeddedAssets}/${vision.totalAssets} asset · ${vision.model}`,
  ].join("\n");
}

function formatStatusOnly(status) {
  return [
    `Indice: ${status.filesIndexed}/${status.filesDiscovered} file · ${status.filesSkipped} saltati`,
    `Watcher: ${status.watcherActive ? "attivo" : "spento"} · coda ${status.watcherQueued || 0}`,
    `Typesense: ${status.typesenseAvailable ? "online" : status.typesenseError || "offline"}`,
    `Semantica: ${status.semanticChunks || 0} chunk · ${shortModel(status.semanticModel || "")}`,
  ].join("\n");
}

function formatDoctorStatus(doctor) {
  const summary = doctor.summary || {};
  const missing = (doctor.checks || []).filter((item) => item.state === "missing").slice(0, 10);
  const warnings = (doctor.checks || []).filter((item) => item.state === "manual").slice(0, 8);
  return [
    `Doctor: ${summary.state === "ready" ? "pronto" : "attenzione"} · ${summary.readyRequired}/${summary.required} richiesti · ${summary.missingRequired} mancanti`,
    `Indice: ${doctor.index?.filesIndexed || 0} file · Semantica ${doctor.semantic?.embeddedChunks || 0} chunk · Vision ${doctor.vision?.embeddedAssets || 0}/${doctor.vision?.totalAssets || 0}`,
    missing.length ? `Mancano:\n${missing.map((item) => `- ${item.label}: ${item.detail}`).join("\n")}` : "Mancanti: nessuno",
    warnings.length ? `Da confermare:\n${warnings.map((item) => `- ${item.label}: ${item.detail}`).join("\n")}` : "",
    `Log diagnostico: ${doctor.logPath}`,
  ].filter(Boolean).join("\n");
}

function formatDoctorExport(result) {
  return `${result.ok ? "OK" : "NO"} diagnostica esportata: ${result.path}`;
}

function formatInstallComponent(result) {
  return [
    `${result.ok ? "OK" : "NO"} ${result.componentId}: ${result.message}`,
    ...(result.steps || []).map((step) => `${step.ok ? "OK" : "NO"} ${step.label}${step.manualAction ? " · manuale" : ""}\n${String(step.output || "").slice(0, 900)}`),
  ].join("\n");
}

function formatModelStatus(status) {
  return [
    `Modelli testo: ${shortModel(status.text?.activeModel || "")} · ${status.text?.embeddedChunks || 0}/${status.text?.totalChunks || 0} chunk`,
    `Vision: ${(status.vision || []).map((item) => `${item.label} ${item.embeddedAssets}/${item.totalAssets}`).join(" · ") || "nessun asset"}`,
    `Persona: ${status.face?.embeddedAssets || 0}/${status.face?.totalAssets || 0} · ${status.face?.optInUse || ""}`,
    `Cache: ${status.cache?.files || 0} file · ${Math.round((status.cache?.bytes || 0) / 1024)} KB`,
  ].join("\n");
}

function formatResults(results) {
  if (!results.length) return "Nessun risultato.";
  return results.map((item, index) => {
    const where = [item.page_hint ? `pagina ${item.page_hint}` : "", item.timestamp !== undefined ? `t=${item.timestamp}s` : ""].filter(Boolean).join(" · ");
    return [
      `${index + 1}. ${item.name} · ${item.kind} · score ${item.score}${where ? ` · ${where}` : ""}`,
      `   ${item.path}`,
      `   ${String(item.snippet || "").replace(/\s+/g, " ").slice(0, 220)}`,
    ].join("\n");
  }).join("\n");
}

function formatAnswer(answer) {
  const citations = (answer.citations || []).map((item, index) =>
    `[${index + 1}] ${item.title}${item.chunkIndex !== undefined ? ` · chunk ${item.chunkIndex + 1}` : ""}`,
  ).join("\n");
  return `${answer.answer}${citations ? `\n\n${citations}` : ""}`;
}

function formatContext(context) {
  return [
    `${context.name} · ${context.kind} · ${context.extension}`,
    context.filePath,
    "",
    String(context.contentPreview || "").slice(0, 3000),
  ].join("\n");
}

function formatRcloneStatus(status) {
  return [
    `Rclone: ${status.installed ? "installato" : "manca"}${status.command ? ` · ${status.command}` : ""}`,
    status.version ? `Versione: ${String(status.version).split("\n")[0]}` : "Versione: n/d",
    `Remote rclone: ${(status.remotes || []).join(", ") || "nessuno"}`,
    `Provider: ${(status.providers || []).map((item) => item.label).join(", ")}`,
  ].join("\n");
}

function formatConnectors(connectors) {
  if (!connectors.length) return "Nessun remote configurato.";
  return connectors.map((item, index) => [
    `${index + 1}. ${item.name} · ${item.provider} · ${item.enabled ? "attivo" : "spento"} · ${item.autoSync ? "auto-sync" : "manuale"}`,
    `   id: ${item.id}`,
    `   sorgente: ${item.provider === "local" ? item.remotePath : `${item.remoteName}:${item.remotePath || ""}`}`,
    `   cache: ${item.cachePath}`,
    `   stato: ${item.lastSyncError || item.lastSyncStatus || "mai sincronizzato"}`,
  ].join("\n")).join("\n");
}

function formatConnectorSave(value) {
  return `Remote salvati: ${(value.connectors || []).length}. Percorsi indicizzati: ${(value.watchPaths || []).length}.`;
}

function formatRemoteTest(result) {
  return [
    `${result.ok ? "OK" : "FAIL"} ${result.connector?.name || "remote"} · ${result.message}`,
    result.sample?.length ? `Esempi: ${result.sample.slice(0, 8).join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

function formatRemoteSync(result) {
  return [
    `${result.ok ? "OK" : "FAIL"} ${result.connector?.name || "remote"} · ${result.filesSynced || 0} file in cache`,
    `Cache: ${result.connector?.cachePath || ""}`,
  ].join("\n");
}

function formatRemoteSyncAll(summary) {
  return `Remote sync: ${summary.synced} completati, ${summary.skipped} saltati, ${summary.errors} errori.`;
}

function formatRemoteAccessStatus(status) {
  return [
    `Remote Access: ${status.running ? "attivo" : "spento"} · ${status.url}`,
    `Bind: ${status.bind}:${status.port} · download ${status.allowFileDownload ? "abilitato" : "bloccato"}`,
    `Token: ${status.token || status.tokenPreview || "n/d"}`,
    `Log: ${status.logPath}`,
    status.lastError ? `Errore: ${status.lastError}` : "",
  ].filter(Boolean).join("\n");
}

function formatPackagingStatus(status) {
  return [
    `Packaging: ${status.readyForCurrentPlatform ? "pronto" : "incompleto"} · ${status.platform}/${status.arch}`,
    `App: ${status.bundle?.productName || "Trova"} ${status.bundle?.version || ""} · target ${status.bundle?.targets || "all"}`,
    ...((status.checks || []).map((check) => `${check.ok ? "OK" : "NO"} ${check.label}: ${check.detail}`)),
    `Dati locali: ${status.dataDir}`,
  ].join("\n");
}

function formatRuntimeBootstrap(result) {
  const status = formatPackagingStatus(result.packaging || {});
  return [
    `${result.ok ? "OK" : "NO"} ${result.message}`,
    `Cache modelli: ${result.modelDir}`,
    status,
  ].join("\n");
}

function upsertById(items, item) {
  return items.some((current) => current.id === item.id)
    ? items.map((current) => current.id === item.id ? { ...current, ...item } : current)
    : [...items, item];
}

function watchPath(folderPath) {
  return {
    id: String(Math.abs(hashCode(folderPath))),
    path: folderPath,
    enabled: true,
    recursive: true,
    isExcluded: false,
    geminiEnabled: false,
    autoIndex: true,
  };
}

function filtersOption(opts) {
  return opts.filters ? String(opts.filters).split(",").map((item) => item.trim()).filter(Boolean) : ["all"];
}

function limitOption(opts, fallback) {
  const value = Number(opts.limit || fallback);
  return Number.isFinite(value) ? Math.max(1, Math.min(250, value)) : fallback;
}

function mimeFromPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".bmp") return "image/bmp";
  if (extension === ".gif") return "image/gif";
  return "image/png";
}

function shortModel(model) {
  return model.split("/").pop()?.replaceAll("-", " ") || model || "n/d";
}

function hashCode(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function printHelp() {
  console.log(`Trova CLI

Uso:
  trova status [--json]
  trova simple-status [--json]
  trova setup [cartella ...] [--wait] [--no-system-changes] [--json]
  trova repair [--wait] [--no-system-changes] [--json]
  trova doctor [status|export] [--json]
  trova install-component tesseract|whisper|ffmpeg|poppler|rclone|tika|typesense [--json]
  trova model-status [--json]
  trova index [cartella ...] [--json]
  trova watch [start|stop] [cartella ...] [--json]
  trova search "query" [--filter all|images|documents|text|audio|video|code] [--limit 20] [--json]
  trova image-search path/to/query.png [--person] [--limit 20] [--json]
  trova ask "domanda" [--limit 6] [--json]
  trova similar "testo" | --file /path/file [--json]
  trova context /path/file [--json]
  trova remotes status|list [--json]
  trova remotes add-local /cartella [--name Nome] [--cloud] [--json]
  trova remotes add-rclone remoteName --provider drive --remote-path cartella [--cloud] [--json]
  trova remotes test connectorId [--json]
  trova remotes sync connectorId [--json]
  trova remotes sync-all [--json]
  trova remote-access status|start|stop|configure [--bind 127.0.0.1|0.0.0.0] [--port 18754] [--no-download] [--json]
  trova package status|bootstrap [--json]
  trova release status|manifest|build [--json]

Richiede local API attiva: npm run local-api`);
}
