#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const API_URL = process.env.TROVA_LOCAL_API_URL || "http://127.0.0.1:17654/api/command";
let inputBuffer = Buffer.alloc(0);

const tools = [
  {
    name: "search_files",
    description: "Cerca nei file indicizzati localmente con full-text, fuzzy e semantica.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        filters: { type: "array", items: { type: "string" } },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "visual_search",
    description: "Cerca immagini, pagine PDF e keyframe video usando una query immagine locale.",
    inputSchema: {
      type: "object",
      properties: {
        imagePath: { type: "string" },
        mode: { type: "string", enum: ["image", "person"] },
        filters: { type: "array", items: { type: "string" } },
        limit: { type: "number" },
      },
      required: ["imagePath"],
    },
  },
  {
    name: "ask_files",
    description: "Risponde in modo estrattivo sui file indicizzati con citazioni locali.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string" },
        filters: { type: "array", items: { type: "string" } },
        limit: { type: "number" },
      },
      required: ["question"],
    },
  },
  {
    name: "index_paths",
    description: "Indicizza una o piu cartelle locali usando il backend Trova.",
    inputSchema: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" } },
      },
      required: ["paths"],
    },
  },
  {
    name: "get_file_context",
    description: "Restituisce contesto, chunk e asset visuali di un file indicizzato.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        maxChars: { type: "number" },
        maxChunks: { type: "number" },
      },
      required: ["filePath"],
    },
  },
  {
    name: "list_remotes",
    description: "Elenca i connector remote/cache configurati in Trova.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "sync_remotes",
    description: "Sincronizza tutti i remote auto-sync in cache locale indicizzabile.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "doctor",
    description: "Esegue il doctor locale di Trova su componenti, modelli, permessi, privacy e packaging.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "simple_status",
    description: "Restituisce lo stato app in forma leggibile per utenti non tecnici.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "auto_setup",
    description: "Avvia la preparazione automatica di Trova sulle cartelle indicate.",
    inputSchema: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" } },
        allowSystemChanges: { type: "boolean" },
      },
    },
  },
  {
    name: "repair_app",
    description: "Prova a riparare automaticamente Trova se manca qualcosa.",
    inputSchema: {
      type: "object",
      properties: {
        allowSystemChanges: { type: "boolean" },
      },
    },
  },
  {
    name: "install_component",
    description: "Installa o prepara un componente locale tramite il backend Trova.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "model_status",
    description: "Restituisce stato di embeddings testuali, vision locale e persona esplicita.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "remote_access_status",
    description: "Controlla lo stato della Web UI remota sicura di Trova.",
    inputSchema: { type: "object", properties: {} },
  },
];

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  void drainMessages();
});

async function drainMessages() {
  while (inputBuffer.length) {
    const parsed = readMessage(inputBuffer);
    if (!parsed) return;
    inputBuffer = inputBuffer.slice(parsed.bytes);
    await handleMessage(parsed.message).catch((err) => {
      if (parsed.message?.id !== undefined) send({
        jsonrpc: "2.0",
        id: parsed.message.id,
        error: { code: -32603, message: String(err?.message || err) },
      });
    });
  }
}

function readMessage(buffer) {
  const text = buffer.toString("utf8");
  if (text.startsWith("Content-Length:")) {
    const headerEnd = text.indexOf("\r\n\r\n");
    if (headerEnd < 0) return null;
    const header = text.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) throw new Error("MCP frame senza Content-Length.");
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) return null;
    const body = buffer.slice(bodyStart, bodyStart + length).toString("utf8");
    return { message: JSON.parse(body), bytes: bodyStart + length };
  }
  const newline = text.indexOf("\n");
  if (newline < 0) return null;
  const line = text.slice(0, newline).trim();
  if (!line) return { message: null, bytes: newline + 1 };
  return { message: JSON.parse(line), bytes: newline + 1 };
}

async function handleMessage(message) {
  if (!message) return;
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "trova-local-search", version: "0.1.0" },
      },
    });
    return;
  }
  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools } });
    return;
  }
  if (message.method === "tools/call") {
    const name = message.params?.name;
    const args = message.params?.arguments || {};
    const result = await callTool(name, args);
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      },
    });
    return;
  }
  if (message.id !== undefined) {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
  }
}

async function callTool(name, args) {
  if (name === "search_files") {
    const results = await api("search_index", {
      request: {
        textQuery: args.query,
        mode: "text",
        filters: args.filters || ["all"],
        semantic: true,
        fuzzy: true,
        limit: args.limit || 20,
        useLocal: true,
        useGemini: false,
      },
    });
    return { results: results.slice(0, args.limit || 20) };
  }
  if (name === "visual_search") {
    const vector = await imageEmbedding(args.imagePath);
    const faceVector = args.mode === "person" ? await faceEmbedding(args.imagePath).catch(() => []) : [];
    const results = await api("search_index", {
      request: {
        imageQuery: vector,
        imageQueries: [vector],
        faceQuery: faceVector,
        faceQueries: faceVector.length ? [faceVector] : [],
        mode: args.mode === "person" ? "person" : "image",
        filters: args.filters || ["all"],
        limit: args.limit || 20,
        useLocal: true,
        useGemini: false,
      },
    });
    return { results: results.slice(0, args.limit || 20) };
  }
  if (name === "ask_files") {
    return api("ask_files", {
      request: {
        question: args.question,
        filters: args.filters || ["all"],
        limit: args.limit || 6,
      },
    });
  }
  if (name === "index_paths") {
    return api("start_indexing", { paths: (args.paths || []).map((item) => watchPath(path.resolve(item))) });
  }
  if (name === "get_file_context") {
    return api("get_file_context", {
      request: {
        filePath: args.filePath,
        maxChars: args.maxChars || 5000,
        maxChunks: args.maxChunks || 8,
      },
    });
  }
  if (name === "list_remotes") {
    return { connectors: await api("get_connectors", {}), rclone: await api("get_rclone_status", {}) };
  }
  if (name === "sync_remotes") {
    return api("sync_all_remotes", {});
  }
  if (name === "doctor") {
    return api("get_doctor_status", {});
  }
  if (name === "simple_status") {
    return api("get_simple_app_status", {});
  }
  if (name === "auto_setup") {
    return api("start_auto_setup", {
      paths: (args.paths || []).map((item) => watchPath(path.resolve(item))),
      allowSystemChanges: args.allowSystemChanges !== false,
    });
  }
  if (name === "repair_app") {
    return api("repair_app", { allowSystemChanges: args.allowSystemChanges !== false });
  }
  if (name === "install_component") {
    return api("install_local_component", { id: args.id });
  }
  if (name === "model_status") {
    return api("get_model_status", {});
  }
  if (name === "remote_access_status") {
    return api("get_remote_access_status", {});
  }
  throw new Error(`Tool MCP non supportato: ${name}`);
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

async function api(command, args) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command, args }),
  }).catch((err) => {
    throw new Error(`local API non raggiungibile su ${API_URL}. Avvia npm run local-api. ${err.message || err}`);
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `${command} fallito`);
  return payload.result;
}

function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
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

function mimeFromPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".bmp") return "image/bmp";
  if (extension === ".gif") return "image/gif";
  return "image/png";
}

function hashCode(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
