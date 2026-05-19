import { execFile as execFileCallback, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

export const execFile = promisify(execFileCallback);
export const ROOT = process.cwd();
export const API_URL = process.env.TROVA_LOCAL_API_URL || "http://127.0.0.1:17654/api/command";
export const STATE_PATH = path.join(ROOT, ".trova", "local-api-state.json");
export const FIXTURE_ROOT = path.join(ROOT, ".trova", "test-fixtures");

export const checks = [];

export function assert(ok, label) {
  checks.push({ ok: Boolean(ok), label });
  if (!ok) throw new Error(label);
}

export function printChecks() {
  console.log(checks.map((item) => `${item.ok ? "OK" : "FAIL"} ${item.label}`).join("\n"));
}

export async function command(commandName, args = {}) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: commandName, args }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `${commandName} failed`);
  return payload.result;
}

export async function withStateRestore(callback) {
  const previousState = await fs.readFile(STATE_PATH, "utf8").catch(() => "");
  try {
    return await callback();
  } finally {
    if (previousState) await fs.writeFile(STATE_PATH, previousState);
  }
}

export async function resetFixture(name) {
  const dir = path.join(FIXTURE_ROOT, name);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function watchPath(id, folderPath, extra = {}) {
  return {
    id,
    path: folderPath,
    enabled: true,
    recursive: true,
    isExcluded: false,
    geminiEnabled: false,
    autoIndex: true,
    sourceType: "local",
    ...extra,
  };
}

export async function mediaCommand(binary) {
  for (const candidate of [
    { command: binary, prefix: [] },
    { command: "host-spawn", prefix: [binary] },
    { command: "flatpak-spawn", prefix: ["--host", binary] },
  ]) {
    try {
      await execFile(candidate.command, [...candidate.prefix, "-version"], { timeout: 4000, maxBuffer: 120_000 });
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

export async function makeColorImage(output, color = "green", extraFilter = "") {
  const ffmpeg = await mediaCommand("ffmpeg");
  if (!ffmpeg) return false;
  await execFile(ffmpeg.command, [
    ...ffmpeg.prefix,
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=white:s=640x420",
    "-vf",
    `drawbox=x=210:y=90:w=210:h=210:color=${color}:t=fill${extraFilter}`,
    "-frames:v",
    "1",
    output,
  ], { timeout: 30_000, maxBuffer: 200_000 });
  return true;
}

export async function makeFaceLikeImage(output, color = "0x6d9eeb") {
  const ffmpeg = await mediaCommand("ffmpeg");
  if (!ffmpeg) return false;
  await execFile(ffmpeg.command, [
    ...ffmpeg.prefix,
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=white:s=640x420",
    "-vf",
    [
      `drawbox=x=230:y=65:w=180:h=210:color=${color}:t=fill`,
      "drawbox=x=275:y=120:w=24:h=24:color=black:t=fill",
      "drawbox=x=338:y=120:w=24:h=24:color=black:t=fill",
      "drawbox=x=285:y=210:w=70:h=16:color=black:t=fill",
    ].join(","),
    "-frames:v",
    "1",
    output,
  ], { timeout: 30_000, maxBuffer: 200_000 });
  return true;
}

export async function makeShortVideo(output) {
  const ffmpeg = await mediaCommand("ffmpeg");
  if (!ffmpeg) return false;
  await execFile(ffmpeg.command, [
    ...ffmpeg.prefix,
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=duration=2:size=640x360:rate=10",
    "-pix_fmt",
    "yuv420p",
    output,
  ], { timeout: 40_000, maxBuffer: 400_000 });
  return true;
}

export async function withLocalApi(callback) {
  if (await apiReady()) return callback();
  const child = spawn("node", ["scripts/local-backend.mjs"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForApi();
    return await callback();
  } finally {
    child.kill("SIGTERM");
  }
}

async function apiReady() {
  try {
    await command("get_index_status", {});
    return true;
  } catch {
    return false;
  }
}

async function waitForApi() {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    if (await apiReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Local API non partita entro 10s.");
}
