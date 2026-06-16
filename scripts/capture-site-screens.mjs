// Screenshot UI Trova per il sito mengo1234. Playwright/chromium.
// Inietta DATI MOCK (intercettando /api/command) solo per le immagini: risultati
// ricerca, stati "pronti", cartelle, recenti. Non tocca i dati reali.
// Tema misto: home/ricerca chiari, impostazioni e tab scuri.
import { chromium } from "playwright";
import { promises as fs } from "node:fs";
import path from "node:path";

const APP_URL = process.env.TROVA_UI_URL || "http://127.0.0.1:1420/";
const OUT_DIR = "/tmp/trova-shots";
const VIEWPORT = { width: 1440, height: 920 };

await fs.mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch({ args: ["--force-color-profile=srgb"] });

const now = 1718500000000;
const f = (id, name, kind, extension, snippet, matchType, score) => ({
  id, name, path: `/home/fabio/Documenti/${name}`, kind, extension,
  size: 1200000, modified: now, timestamp: now, snippet, matchType, score, source: "local", sourceType: "local",
});
const RESULTS = [
  f("1", "Relazione tecnica progetto.pdf", "document", "pdf", "…la relazione tecnica descrive le fasi del progetto e i costi previsti per…", "semantic", 0.97),
  f("2", "Contratto fornitura 2024.docx", "document", "docx", "…documento di contratto per la fornitura dei materiali con scadenza…", "text", 0.93),
  f("3", "Preventivo ristrutturazione.xlsx", "document", "xlsx", "…foglio con il preventivo dettagliato e il computo metrico delle opere…", "text", 0.9),
  f("4", "Foto cantiere ingresso.jpg", "image", "jpg", "scena: cantiere edile, impalcatura, ingresso", "visual", 0.88),
  f("5", "Render salotto.png", "image", "png", "scena: salotto, divano, finestra luminosa", "visual", 0.86),
  f("6", "Sopralluogo video.mp4", "video", "mp4", "minuto 02:14 — descrizione dei lavori al primo piano", "visual", 0.82),
  f("7", "Appunti riunione.md", "document", "md", "…appunti della riunione con i punti aperti e le decisioni prese…", "text", 0.79),
  f("8", "main.tsx", "code", "tsx", "export function App() { … ricerca locale dei documenti …", "text", 0.74),
];

const PATHS = [
  { id: "p1", path: "/home/fabio/Documenti", enabled: true, recursive: true, isExcluded: false, geminiEnabled: false, autoIndex: true, sourceType: "local" },
  { id: "p2", path: "/home/fabio/Download", enabled: true, recursive: true, isExcluded: false, geminiEnabled: false, autoIndex: true, sourceType: "local" },
  { id: "p3", path: "/home/fabio/Immagini", enabled: true, recursive: true, isExcluded: false, geminiEnabled: true, autoIndex: true, sourceType: "local" },
];

const MOCKS = {
  get_index_status: { filesIndexed: 4827, filesDiscovered: 4827, progress: 100, running: false, watcherActive: true, semanticChunks: 12840 },
  search_index: RESULTS,
  load_watch_paths: PATHS,
  get_default_watch_paths: PATHS,
  get_local_vision_status: { totalAssets: 1240, embeddedAssets: 1240, models: [{ model: "clip", totalAssets: 1240, embeddedAssets: 1240 }] },
  get_ollama_install_status: { label: "AI locale pronta", progress: 100, running: false },
  get_ai_provider_status: { providers: [{ id: "ollama", label: "Ollama (locale)", configured: true, models: [{ key: "gemma3:4b", label: "Gemma 3 · 4B", category: "chat" }] }], activeProvider: "ollama", activeModel: "gemma3:4b" },
  get_semantic_status: { ready: true, embeddedChunks: 12840 },
  get_packaging_status: { readyForCurrentPlatform: true },
  get_auto_setup_status: { id: "x", status: "done", progress: 100, message: "Tutto pronto" },
  get_simple_app_status: {
    generatedAt: now, status: "ready", title: "Tutto pronto",
    message: "Trova e' pronta: cerca tra i tuoi documenti, foto, audio e video.",
    progress: 100, actionLabel: "Apri ricerca", issues: [],
    sections: [
      { id: "files", label: "Ricerca file", ready: true, state: "ready", message: "4.827 file pronti" },
      { id: "vision", label: "Foto e video", ready: true, state: "ready", message: "1.240 elementi pronti" },
      { id: "ai", label: "AI locale", ready: true, state: "ready", message: "Gemma 3 pronta" },
      { id: "cloud", label: "Online", ready: false, state: "off", message: "Spento (solo locale)" },
    ],
    job: { id: "x", status: "done", progress: 100, message: "Tutto pronto" },
    components: [], detailsAvailable: true,
  },
};

async function newPage(theme) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  await context.route("**/api/command", async (route) => {
    let cmd = "";
    try { cmd = JSON.parse(route.request().postData() || "{}").command; } catch {}
    if (!Object.prototype.hasOwnProperty.call(MOCKS, cmd)) {
      // comando non mockato -> backend reale (evita crash da shape sbagliata in Impostazioni)
      return route.continue();
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, result: MOCKS[cmd] }) });
  });
  // chat stream: chiudi subito (non serve per gli screenshot)
  await context.route("**/api/chat/stream", (route) => route.fulfill({ status: 200, body: "" }));
  await context.addInitScript(({ t, recent, searches }) => {
    localStorage.setItem("trova.setupComplete", "true");
    localStorage.setItem("trova.theme", t);
    localStorage.setItem("trova.recentFiles", JSON.stringify(recent));
    localStorage.setItem("trova.recentSearches", JSON.stringify(searches));
  }, { t: theme, recent: RESULTS.slice(0, 6), searches: ["relazione progetto", "foto cantiere", "preventivo 2024", "contratto fornitura"] });
  const page = await context.newPage();
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), theme);
  await page.waitForTimeout(1300);
  return { context, page };
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
  console.log("OK", name);
}
async function openSettings(page) {
  await page.getByRole("button", { name: /Impostazioni/i }).first().click().catch(() => {});
  await page.waitForTimeout(1000);
}
async function openTab(page, label) {
  await page.getByRole("button", { name: label }).first().click().catch(() => {});
  await page.waitForTimeout(900);
}

{ const { context, page } = await newPage("light"); await page.waitForTimeout(1500); await shot(page, "home"); await context.close(); }

{
  const { context, page } = await newPage("light");
  const input = page.locator(".search-box input, .search-row input").first();
  await input.click().catch(() => {});
  await input.fill("documento").catch(() => {});
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2200);
  await shot(page, "search");
  await context.close();
}

{
  const { context, page } = await newPage("dark");
  await openSettings(page); await shot(page, "settings");
  await openTab(page, /Cartelle/i); await shot(page, "folders");
  await openTab(page, /Online/i); await shot(page, "cloud");
  await openTab(page, /Foto e video/i); await shot(page, "vision");
  await context.close();
}

await browser.close();
console.log("DONE");
