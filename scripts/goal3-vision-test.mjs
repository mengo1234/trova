import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const ROOT = process.cwd();
const API_URL = process.env.TROVA_LOCAL_API_URL || "http://127.0.0.1:17654/api/command";
const STATE_PATH = path.join(ROOT, ".trova", "local-api-state.json");
const FIXTURE_DIR = path.join(ROOT, ".trova", "test-fixtures", "goal3-vision");
const checks = [];

await fs.mkdir(FIXTURE_DIR, { recursive: true });
const previousState = await fs.readFile(STATE_PATH, "utf8").catch(() => "");

try {
  await writeFixtures();
  const watchPath = {
    id: "goal3-vision-fixtures",
    path: FIXTURE_DIR,
    enabled: true,
    recursive: true,
    isExcluded: false,
    geminiEnabled: false,
    autoIndex: true,
  };

  const status = await command("start_indexing", { paths: [watchPath] });
  assert(status.filesIndexed >= 4, `indicizzazione vision: ${status.filesIndexed} file`);

  const assets = await command("list_visual_assets", {});
  const pdfPages = assets.filter((asset) => asset.filePath.endsWith("visual-pages.pdf"));
  const videoFrames = assets.filter((asset) => asset.filePath.endsWith("red-scene.mp4"));
  assert(pdfPages.length >= 3, `PDF multipagina indicizzato: ${pdfPages.length} pagine`);
  assert(videoFrames.length >= 2, `video keyframe indicizzati: ${videoFrames.length} frame`);
  assert(assets.some((asset) => asset.embeddingModels?.includes("trova-fingerprint-v1")), "fingerprint visuale backend presente");

  const queryVector = await command("visual_embedding_from_data_url", {
    dataUrl: await dataUrl(path.join(FIXTURE_DIR, "query-red-square.png")),
  });
  assert(Array.isArray(queryVector) && queryVector.length === 195, `query image embedding backend: ${queryVector.length}`);

  const visualResults = await command("search_index", {
    request: {
      imageQuery: queryVector,
      imageQueries: [queryVector],
      mode: "image",
      filters: ["all"],
      useLocal: true,
      useGemini: false,
    },
  });
  assert(visualResults.some((item) => item.name === "red-square.png"), "immagine→immagine trova PNG simile");
  assert(visualResults.some((item) => item.name === "visual-pages.pdf" && item.page_hint === 2), "immagine→PDF trova pagina corretta");
  assert(visualResults.some((item) => item.name === "red-scene.mp4" && typeof item.timestamp === "number"), "immagine→video trova keyframe con timestamp");

  const ocrResults = await command("search_index", {
    request: {
      textQuery: "piantina alpha",
      mode: "text",
      filters: ["all"],
      semantic: true,
      useLocal: true,
      useGemini: false,
    },
  });
  assert(ocrResults.some((item) => item.name === "ocr-piantina.png"), "OCR + vision rende trovabile testo dentro immagine");

  const personResults = await command("search_index", {
    request: {
      imageQuery: queryVector,
      imageQueries: [queryVector],
      mode: "person",
      filters: ["all"],
      useLocal: true,
      useGemini: false,
    },
  });
  assert(personResults.some((item) => item.name === "red-square.png" && item.matchType === "person"), "modalita persona esplicita usa match locale senza nome");

  console.log(checks.map((item) => `${item.ok ? "OK" : "FAIL"} ${item.label}`).join("\n"));
} finally {
  if (previousState) await fs.writeFile(STATE_PATH, previousState);
}

async function writeFixtures() {
  const ffmpeg = await mediaCommand("ffmpeg");
  if (!ffmpeg) throw new Error("FFmpeg richiesto per generare fixture vision reali.");

  await makeRedSquareImage(ffmpeg, path.join(FIXTURE_DIR, "query-red-square.png"));
  await makeRedSquareImage(ffmpeg, path.join(FIXTURE_DIR, "red-square.png"));
  await makeBlueImage(ffmpeg, path.join(FIXTURE_DIR, "blue-control.png"));
  await makeOcrImage(ffmpeg, path.join(FIXTURE_DIR, "ocr-piantina.png"));
  await makeVideo(ffmpeg, path.join(FIXTURE_DIR, "red-scene.mp4"));
  await fs.writeFile(path.join(FIXTURE_DIR, "visual-pages.pdf"), makeVisualPdf());
}

async function makeRedSquareImage(ffmpeg, output) {
  await execFile(ffmpeg.command, [
    ...ffmpeg.prefix,
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=white:s=640x360",
    "-vf",
    "drawbox=x=220:y=80:w=200:h=200:color=red:t=fill",
    "-frames:v",
    "1",
    output,
  ], { timeout: 30_000, maxBuffer: 200_000 });
}

async function makeBlueImage(ffmpeg, output) {
  await execFile(ffmpeg.command, [
    ...ffmpeg.prefix,
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=white:s=640x360",
    "-vf",
    "drawbox=x=220:y=80:w=200:h=200:color=blue:t=fill",
    "-frames:v",
    "1",
    output,
  ], { timeout: 30_000, maxBuffer: 200_000 });
}

async function makeOcrImage(ffmpeg, output) {
  await execFile(ffmpeg.command, [
    ...ffmpeg.prefix,
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=white:s=1000x360",
    "-vf",
    "drawtext=text='piantina alpha':fontcolor=black:fontsize=58:x=70:y=150",
    "-frames:v",
    "1",
    output,
  ], { timeout: 30_000, maxBuffer: 200_000 });
}

async function makeVideo(ffmpeg, output) {
  await execFile(ffmpeg.command, [
    ...ffmpeg.prefix,
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=white:s=640x360:d=7",
    "-vf",
    "drawbox=x=220:y=80:w=200:h=200:color=red:t=fill",
    "-pix_fmt",
    "yuv420p",
    output,
  ], { timeout: 40_000, maxBuffer: 400_000 });
}

function makeVisualPdf() {
  const pageStreams = [
    "q 1 1 1 rg 0 0 640 360 re f 0 0 1 rg 220 80 200 200 re f Q",
    "q 1 1 1 rg 0 0 640 360 re f 1 0 0 rg 220 80 200 200 re f Q",
    "q 1 1 1 rg 0 0 640 360 re f 0 0.7 0 rg 220 80 200 200 re f Q",
  ];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 640 360] /Contents 4 0 R >>",
    streamObject(pageStreams[0]),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 640 360] /Contents 6 0 R >>",
    streamObject(pageStreams[1]),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 640 360] /Contents 8 0 R >>",
    streamObject(pageStreams[2]),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}

function streamObject(content) {
  return `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
}

async function dataUrl(filePath) {
  const bytes = await fs.readFile(filePath);
  return `data:image/png;base64,${bytes.toString("base64")}`;
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

function assert(ok, label) {
  checks.push({ ok, label });
  if (!ok) throw new Error(label);
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
      // try next candidate
    }
  }
  return null;
}
