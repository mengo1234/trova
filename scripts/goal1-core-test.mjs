import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const ROOT = process.cwd();
const API_URL = process.env.TROVA_LOCAL_API_URL || "http://127.0.0.1:17654/api/command";
const STATE_PATH = path.join(ROOT, ".trova", "local-api-state.json");
const FIXTURE_DIR = path.join(ROOT, ".trova", "test-fixtures", "goal1-core");

const checks = [];

await fs.mkdir(FIXTURE_DIR, { recursive: true });
await fs.mkdir(path.join(FIXTURE_DIR, "nested"), { recursive: true });

const previousState = await fs.readFile(STATE_PATH, "utf8").catch(() => "");

try {
  await writeFixtureFiles();
  await command("stop_watcher", {});

  const watchPath = {
    id: "goal1-core-fixtures",
    path: FIXTURE_DIR,
    enabled: true,
    recursive: true,
    isExcluded: false,
    geminiEnabled: false,
    autoIndex: true,
  };

  const indexStatus = await command("start_indexing", { paths: [watchPath] });
  assert(indexStatus.filesIndexed >= 2, `indicizzazione fixture: ${indexStatus.filesIndexed} file`);

  const elephant = await search("elefante");
  assert(elephant.some((item) => item.name === "elefante-note.txt"), "ricerca testo trova TXT reale");

  const fuzzy = await search("elefnate");
  assert(fuzzy.some((item) => item.name === "elefante-note.txt"), "fuzzy locale corregge typo elefnate");

  const ocrImage = path.join(FIXTURE_DIR, "ocr-elefante.png");
  if (await exists(ocrImage)) {
    const ocr = await search("ocr elefante");
    assert(ocr.some((item) => item.name === "ocr-elefante.png"), "OCR Tesseract trova testo dentro immagine");
  } else {
    checks.push({ ok: true, label: "OCR immagine saltato: FFmpeg/drawtext non disponibile nel test" });
  }

  await command("start_watcher", { paths: [watchPath] });
  const watcherFile = path.join(FIXTURE_DIR, "watcher-elefante.txt");
  await fs.writeFile(watcherFile, "elefante watcher creato in tempo reale");
  await waitForSearch("watcher creato", "watcher-elefante.txt", true);

  await fs.rm(watcherFile, { force: true });
  await waitForSearch("watcher creato", "watcher-elefante.txt", false);
  await command("stop_watcher", {});

  const components = await command("get_local_components", {});
  const whisper = components.find((item) => item.id === "whisper");
  assert(Boolean(whisper?.installed), "Whisper locale rilevato dal backend");

  console.log(checks.map((item) => `${item.ok ? "OK" : "FAIL"} ${item.label}`).join("\n"));
} finally {
  await command("stop_watcher", {}).catch(() => null);
  if (previousState) await fs.writeFile(STATE_PATH, previousState);
}

async function writeFixtureFiles() {
  await fs.writeFile(
    path.join(FIXTURE_DIR, "elefante-note.txt"),
    "Un elefante africano compare nel documento di prova. La parola serve per testare fuzzy, indice e snippet reali.",
  );
  await fs.writeFile(
    path.join(FIXTURE_DIR, "nested", "manuale-piantina.md"),
    "# Piantina ufficio\n\nQuesta fixture contiene una piantina e uno schema per testare cartelle ricorsive.",
  );
  await createOcrFixture().catch(() => null);
}

async function createOcrFixture() {
  const output = path.join(FIXTURE_DIR, "ocr-elefante.png");
  if (await exists(output)) return;
  const ffmpeg = await mediaCommand("ffmpeg");
  if (!ffmpeg) return;
  await execFile(ffmpeg.command, [
    ...ffmpeg.prefix,
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=white:s=1000x360",
    "-vf",
    "drawtext=text='elefante OCR locale':fontcolor=black:fontsize=54:x=60:y=150",
    "-frames:v",
    "1",
    output,
  ], { timeout: 30_000, maxBuffer: 200_000 });
}

async function waitForSearch(query, expectedName, shouldExist) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const results = await search(query);
    const found = results.some((item) => item.name === expectedName);
    if (found === shouldExist) {
      assert(true, `watcher ${shouldExist ? "aggiunge" : "rimuove"} ${expectedName}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 450));
  }
  assert(false, `watcher ${shouldExist ? "aggiunge" : "rimuove"} ${expectedName}`);
}

async function search(textQuery) {
  return command("search_index", {
    request: {
      textQuery,
      mode: "text",
      filters: ["all"],
      useLocal: true,
      useGemini: false,
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
      // keep looking
    }
  }
  return null;
}

async function exists(filePath) {
  return fs.access(filePath).then(() => true, () => false);
}
