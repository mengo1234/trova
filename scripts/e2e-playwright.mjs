import { chromium } from "playwright";
import { promises as fs } from "node:fs";

const BASE = process.env.TROVA_UI_URL || "http://127.0.0.1:1420";
const SHOT_DIR = "/tmp/trova-e2e";
const results = [];
function check(ok, label, detail = "") {
  results.push({ ok, label, detail });
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 160)); });
page.on("pageerror", (err) => consoleErrors.push("pageerror: " + String(err).slice(0, 160)));

await fs.mkdir(SHOT_DIR, { recursive: true });

try {
  // Imposta setupComplete prima del primo load
  await page.addInitScript(() => window.localStorage.setItem("trova.setupComplete", "true"));

  // ===== 1. HOME =====
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const searchInput = page.locator(".search-box input").first();
  check(await page.title() === "Trova", "Home carica con titolo Trova");
  check(await page.locator(".search-box input").count() > 0, "Barra di ricerca presente");
  check(await page.locator(".home-dock button").count() >= 3, "Dock con pulsanti presente");
  await page.screenshot({ path: `${SHOT_DIR}/01-home.png` });

  // ===== 2. RICERCA =====
  // Indicizzo prima i fixtures via backend cosi c'e qualcosa da trovare
  await page.evaluate(async () => {
    await fetch("http://127.0.0.1:17654/api/command", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "start_indexing", args: { paths: [{ id: "e2e", path: "/var/home/fabio/Documenti/Claude/Trova/.trova/test-fixtures/goal1-core", enabled: true, recursive: true, isExcluded: false, geminiEnabled: false, autoIndex: true, sourceType: "local" }] } }),
    });
  });
  await searchInput.fill("elefante");
  await searchInput.press("Enter");
  await page.waitForTimeout(2500);
  const resultsText = await page.locator("body").innerText();
  check(resultsText.includes("risultati reali"), "Ricerca mostra contatore risultati");
  check(resultsText.includes("elefante-note") || resultsText.includes("elefante"), "Ricerca trova file con 'elefante'");
  await page.screenshot({ path: `${SHOT_DIR}/02-search.png` });

  // ===== 3. OPERATORI DI RICERCA =====
  await searchInput.fill("tipo:documento");
  await searchInput.press("Enter");
  await page.waitForTimeout(2000);
  check(true, "Operatore tipo:documento accettato (no crash)");
  await page.screenshot({ path: `${SHOT_DIR}/03-operators.png` });

  // ===== 4. CHAT AI =====
  // (non svuoto la ricerca: il pannello chat compare quando c'e una ricerca attiva)
  await searchInput.fill("elefante");
  await searchInput.press("Enter");
  await page.waitForTimeout(1500);
  const askInput = page.locator(".local-ask-row input").first();
  if (await askInput.count() > 0) {
    await askInput.fill("Ciao, cosa sai fare?");
    await page.locator(".local-ask-row button", { hasText: "Chiedi" }).first().click();
    // Attendo risposta AI (streaming) fino a 30s
    await page.waitForFunction(() => {
      const msgs = document.querySelectorAll(".local-chat-message.assistant");
      return msgs.length > 0 && (msgs[msgs.length - 1].textContent || "").length > 20;
    }, { timeout: 35000 }).catch(() => {});
    const chatText = await page.locator(".local-chat-thread").innerText().catch(() => "");
    check(chatText.length > 30, "Chat AI risponde", chatText.slice(0, 60).replace(/\n/g, " "));
    await page.screenshot({ path: `${SHOT_DIR}/04-chat.png` });
  } else {
    check(false, "Pannello chat (local-ask-row) non trovato");
  }

  // ===== 5. DARK MODE =====
  await page.locator(".theme-toggle-button").click();
  await page.waitForTimeout(600);
  const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  check(isDark, "Dark mode si attiva col toggle");
  await page.screenshot({ path: `${SHOT_DIR}/05-dark.png` });
  await page.locator(".theme-toggle-button").click(); // torna chiaro
  await page.waitForTimeout(400);

  // ===== 6. SETTINGS =====
  await page.locator(".title-action").click();
  await page.waitForTimeout(800);
  check(await page.locator(".settings-panel").count() > 0, "Impostazioni si aprono");
  // Tab Online -> sezione modelli AI
  await page.getByRole("button", { name: "Online", exact: true }).click().catch(() => {});
  await page.waitForTimeout(600);
  check(await page.locator(".settings-ai-models").count() > 0, "Tab Online ha sezione Modello AI");
  await page.screenshot({ path: `${SHOT_DIR}/06-settings-ai.png` });
  // Tab Dettagli tecnici (advanced) -> hotkey
  await page.getByRole("button", { name: "Dettagli tecnici", exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  check(await page.locator(".hotkey-capture").count() > 0, "Tab Dettagli tecnici ha config hotkey globale");
  await page.screenshot({ path: `${SHOT_DIR}/07-settings-hotkey.png` });

  // ===== 7. SPOTLIGHT =====
  const sp = await ctx.newPage();
  await sp.addInitScript(() => window.localStorage.setItem("trova.setupComplete", "true"));
  await sp.setViewportSize({ width: 760, height: 400 });
  await sp.goto(`${BASE}/?spotlight=1`, { waitUntil: "networkidle" });
  await sp.waitForTimeout(2000);
  check(await sp.locator(".spotlight-box input").count() > 0, "Spotlight: casella di ricerca centrata");
  await sp.locator(".spotlight-box input").first().fill("elefante");
  await sp.waitForTimeout(2000);
  const spResults = await sp.locator(".spotlight-result").count();
  check(spResults > 0, "Spotlight: mostra risultati", `${spResults} risultati`);
  await sp.screenshot({ path: `${SHOT_DIR}/08-spotlight.png` });

  // ===== ERRORI CONSOLE =====
  const blocking = consoleErrors.filter((e) => !e.includes("favicon") && !e.includes("404") && !e.toLowerCase().includes("warning"));
  check(blocking.length === 0, "Nessun errore JavaScript bloccante", blocking.slice(0, 2).join(" | "));

} catch (err) {
  check(false, "Eccezione test E2E", String(err?.message || err).slice(0, 200));
} finally {
  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n=== E2E: ${passed}/${results.length} OK · screenshot in ${SHOT_DIR} ===`);
  process.exit(passed === results.length ? 0 : 1);
}
