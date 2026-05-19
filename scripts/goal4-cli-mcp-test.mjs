import { spawn, execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const ROOT = process.cwd();
const STATE_PATH = path.join(ROOT, ".trova", "local-api-state.json");
const FIXTURE_DIR = path.join(ROOT, ".trova", "test-fixtures", "goal4-cli-mcp");
const CLI = path.join(ROOT, "scripts", "trova-cli.mjs");
const MCP = path.join(ROOT, "scripts", "trova-mcp-server.mjs");
const checks = [];
const previousState = await fs.readFile(STATE_PATH, "utf8").catch(() => "");

try {
  await fs.mkdir(FIXTURE_DIR, { recursive: true });
  await writeFixtures();

  const indexStatus = await cliJson(["index", FIXTURE_DIR]);
  assert(indexStatus.filesIndexed >= 2, `CLI index indicizza fixture: ${indexStatus.filesIndexed}`);

  const status = await cliJson(["status"]);
  assert(status.status.filesIndexed >= 2, "CLI status legge indice reale");

  const search = await cliJson(["search", "elefante agente cli", "--limit", "5"]);
  assert(search.some((item) => item.name === "agente-elefante.txt"), "CLI search trova file testuale");

  const answer = await cliJson(["ask", "Dove si parla di elefante e agenti?", "--limit", "4"]);
  assert(answer.citations.some((item) => item.title === "agente-elefante.txt"), "CLI ask produce citazione locale");

  const image = await cliJson(["image-search", path.join(FIXTURE_DIR, "query-green.png"), "--limit", "6"]);
  assert(image.some((item) => item.name === "green-square.png"), "CLI image-search trova immagine simile");

  const context = await cliJson(["context", path.join(FIXTURE_DIR, "agente-elefante.txt")]);
  assert(context.name === "agente-elefante.txt" && context.chunks.length > 0, "CLI context restituisce chunk");

  const mcp = await withMcp(async (client) => {
    const tools = await client.request("tools/list", {});
    assert(tools.tools.some((tool) => tool.name === "search_files"), "MCP tools/list espone search_files");

    const mcpSearch = await client.tool("search_files", { query: "elefante agente cli", limit: 5 });
    assert(mcpSearch.results.some((item) => item.name === "agente-elefante.txt"), "MCP search_files trova file");

    const mcpVisual = await client.tool("visual_search", { imagePath: path.join(FIXTURE_DIR, "query-green.png"), limit: 6 });
    assert(mcpVisual.results.some((item) => item.name === "green-square.png"), "MCP visual_search trova immagine");

    const mcpAsk = await client.tool("ask_files", { question: "Dove si parla di elefante?", limit: 4 });
    assert(mcpAsk.citations.some((item) => item.title === "agente-elefante.txt"), "MCP ask_files cita file");

    const mcpContext = await client.tool("get_file_context", { filePath: path.join(FIXTURE_DIR, "agente-elefante.txt") });
    assert(mcpContext.name === "agente-elefante.txt", "MCP get_file_context restituisce contesto");
    return true;
  });
  assert(mcp, "MCP stdio completa il giro tool");

  console.log(checks.map((item) => `${item.ok ? "OK" : "FAIL"} ${item.label}`).join("\n"));
} finally {
  if (previousState) await fs.writeFile(STATE_PATH, previousState);
}

async function writeFixtures() {
  await fs.writeFile(
    path.join(FIXTURE_DIR, "agente-elefante.txt"),
    "Il file parla di un elefante usato per testare agenti, CLI, MCP e domande locali con citazioni.",
  );
  await fs.writeFile(
    path.join(FIXTURE_DIR, "agente-balena.txt"),
    "Questo file parla di una balena e serve come controllo semantico diverso dall'elefante.",
  );
  const ffmpeg = await mediaCommand("ffmpeg");
  if (!ffmpeg) return;
  await makeGreenImage(ffmpeg, path.join(FIXTURE_DIR, "query-green.png"));
  await makeGreenImage(ffmpeg, path.join(FIXTURE_DIR, "green-square.png"));
}

async function makeGreenImage(ffmpeg, output) {
  await execFile(ffmpeg.command, [
    ...ffmpeg.prefix,
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=white:s=640x360",
    "-vf",
    "drawbox=x=220:y=80:w=200:h=200:color=green:t=fill",
    "-frames:v",
    "1",
    output,
  ], { timeout: 30_000, maxBuffer: 200_000 });
}

async function cliJson(args) {
  const { stdout, stderr } = await execFile("node", [CLI, ...args, "--json"], {
    cwd: ROOT,
    timeout: 120_000,
    maxBuffer: 5_000_000,
  });
  if (stderr.trim()) {
    // CLI uses stderr only for hard errors, but keep room for future warnings.
  }
  return JSON.parse(stdout);
}

async function withMcp(callback) {
  const child = spawn("node", [MCP], {
    cwd: ROOT,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const client = createMcpClient(child);
  try {
    await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "goal4-test", version: "0.1.0" },
    });
    return await callback(client);
  } finally {
    child.kill("SIGTERM");
  }
}

function createMcpClient(child) {
  let nextId = 1;
  let buffer = Buffer.alloc(0);
  const pending = new Map();
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length) {
      const parsed = readFrame(buffer);
      if (!parsed) break;
      buffer = buffer.slice(parsed.bytes);
      const item = pending.get(parsed.message.id);
      if (!item) continue;
      pending.delete(parsed.message.id);
      if (parsed.message.error) item.reject(new Error(parsed.message.error.message));
      else item.resolve(parsed.message.result);
    }
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });
  return {
    request(method, params) {
      const id = nextId++;
      const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          reject(new Error(`MCP timeout ${method}`));
        }, 30_000);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          },
        });
      });
    },
    async tool(name, args) {
      const result = await this.request("tools/call", { name, arguments: args });
      return result.structuredContent || JSON.parse(result.content?.[0]?.text || "{}");
    },
  };
}

function readFrame(buffer) {
  const text = buffer.toString("utf8");
  const headerEnd = text.indexOf("\r\n\r\n");
  if (headerEnd < 0) return null;
  const header = text.slice(0, headerEnd);
  const match = header.match(/Content-Length:\s*(\d+)/i);
  if (!match) throw new Error("Frame MCP non valido");
  const length = Number(match[1]);
  const bodyStart = headerEnd + 4;
  if (buffer.length < bodyStart + length) return null;
  const body = buffer.slice(bodyStart, bodyStart + length).toString("utf8");
  return { message: JSON.parse(body), bytes: bodyStart + length };
}

async function mediaCommand(binary) {
  const candidates = [
    { command: binary, prefix: [] },
    { command: "host-spawn", prefix: [binary] },
    { command: "flatpak-spawn", prefix: ["--host", binary] },
  ];
  for (const candidate of candidates) {
    try {
      await execFile(candidate.command, [...candidate.prefix, "-version"], { timeout: 3000, maxBuffer: 120_000 });
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

function assert(ok, label) {
  checks.push({ ok, label });
  if (!ok) throw new Error(label);
}
