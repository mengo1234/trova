import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const API_URL = process.env.TROVA_LOCAL_API_URL || "http://127.0.0.1:17654/api/command";
const STATE_PATH = path.join(ROOT, ".trova", "local-api-state.json");
const FIXTURE_DIR = path.join(ROOT, ".trova", "test-fixtures", "goal2-semantic");
const checks = [];

await fs.mkdir(FIXTURE_DIR, { recursive: true });
const previousState = await fs.readFile(STATE_PATH, "utf8").catch(() => "");

try {
  await writeFixtures();
  const watchPath = {
    id: "goal2-semantic-fixtures",
    path: FIXTURE_DIR,
    enabled: true,
    recursive: true,
    isExcluded: false,
    geminiEnabled: false,
    autoIndex: true,
  };

  const status = await command("start_indexing", { paths: [watchPath] });
  assert(status.semanticChunks >= 3, `chunk semantici indicizzati: ${status.semanticChunks}`);

  const semantic = await command("get_semantic_status", {});
  assert(semantic.embeddedChunks >= 3, `embedding testuali pronti: ${semantic.embeddedChunks}`);

  const search = await command("search_index", {
    request: {
      textQuery: "animale africano con proboscide",
      filters: ["all"],
      mode: "text",
      semantic: true,
      fuzzy: true,
      useLocal: true,
      useGemini: false,
    },
  });
  assert(search.some((item) => item.name === "elefante-savana.txt"), "search semantica trova documento elefante");

  const similar = await command("find_similar_files", {
    request: {
      textQuery: "proboscide savana grande mammifero",
      filters: ["all"],
      limit: 5,
    },
  });
  assert(similar[0]?.name === "elefante-savana.txt", "file simili per testo ordinati correttamente");

  const answer = await command("ask_files", {
    request: {
      question: "Dove si parla di proboscide e savana?",
      filters: ["all"],
      limit: 4,
    },
  });
  assert(answer.citations.some((item) => item.title === "elefante-savana.txt"), "ask_files cita il file corretto");
  assert(answer.answer.includes("[1]"), "ask_files produce risposta estrattiva con citazioni");

  const chat = await command("chat_with_files", {
    request: {
      question: "Riassumi cosa dice il file sugli elefanti",
      filters: ["all"],
      limit: 4,
    },
  });
  assert(Boolean(chat.threadId), "chat locale crea thread");
  assert(chat.messages.length >= 2, "chat locale salva messaggi con risposta");

  console.log(checks.map((item) => `${item.ok ? "OK" : "FAIL"} ${item.label}`).join("\n"));
} finally {
  if (previousState) await fs.writeFile(STATE_PATH, previousState);
}

async function writeFixtures() {
  await fs.writeFile(
    path.join(FIXTURE_DIR, "elefante-savana.txt"),
    [
      "L'elefante africano vive nella savana e usa una lunga proboscide per bere acqua.",
      "Il documento descrive un grande mammifero, le zanne, il branco e gli habitat caldi.",
      "Questa nota serve a testare ricerca semantica, file simili e risposte estrattive locali.",
    ].join(" "),
  );
  await fs.writeFile(
    path.join(FIXTURE_DIR, "balena-oceano.txt"),
    [
      "La balena nuota nell'oceano, comunica con canti lunghi e respira in superficie.",
      "Il testo parla di mammiferi marini, profondita e migrazioni stagionali.",
    ].join(" "),
  );
  await fs.writeFile(
    path.join(FIXTURE_DIR, "auto-elettrica.txt"),
    [
      "Un'auto elettrica usa batterie, motori a magneti permanenti e stazioni di ricarica.",
      "Il contenuto e intenzionalmente lontano dagli animali della savana.",
    ].join(" "),
  );
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
