import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const API_URL = process.env.TROVA_LOCAL_API_URL || "http://127.0.0.1:17654/api/command";
const APP_URL = process.env.TROVA_UI_URL || "http://127.0.0.1:1420/";
const CDP_URL = process.env.TROVA_CDP_URL || "http://127.0.0.1:9222";
const OUT_DIR = path.join(ROOT, "src", "assets", "setup", "generated");
const FIXTURE_DIR = path.join(ROOT, ".trova", "test-fixtures", "setup-screens");

await fs.mkdir(OUT_DIR, { recursive: true });
await writeFixtures();
await command("start_indexing", {
  paths: [
    {
      id: "setup-screen-fixture",
      path: FIXTURE_DIR,
      enabled: true,
      recursive: true,
      isExcluded: false,
      geminiEnabled: false,
      autoIndex: true,
      sourceType: "local",
    },
  ],
});

const client = await connectToTrovaTab();
try {
  await client.enable();
  await client.setViewport(1440, 940, 1);
  await client.evaluate(`window.localStorage.setItem("trova.setupComplete", "true")`);
  await client.reload();
  await client.waitForText("Ricerca nei file", 10_000);
  await client.evaluate(`(${searchElephant.toString()})()`);
  await client.waitForText("setup-elefante.txt", 10_000);
  await client.capture(path.join(OUT_DIR, "setup-app-real-search.png"));

  await client.evaluate(`window.localStorage.setItem("trova.setupComplete", "true")`);
  await client.reload();
  await client.waitForText("Ricerca nei file", 10_000);
  const openedSettings = await client.evaluate(`(${openSettings.toString()})()`);
  if (!openedSettings) throw new Error("Settings panel did not open for screenshot capture.");
  await client.waitForText("Stato app", 10_000);
  await client.evaluate(`(${pinSettingsForScreenshot.toString()})()`);
  await client.capture(path.join(OUT_DIR, "setup-app-real-settings.png"));

  await client.evaluate(`window.localStorage.removeItem("trova.setupComplete")`);
  await client.reload();
  await client.waitForText("Setup Trova", 10_000);
  await client.capture(path.join(OUT_DIR, "setup-app-real-onboarding.png"));

  console.log("Captured setup screenshots in src/assets/setup/generated.");
} finally {
  client.close();
}

async function writeFixtures() {
  await fs.rm(FIXTURE_DIR, { recursive: true, force: true });
  await fs.mkdir(FIXTURE_DIR, { recursive: true });
  await fs.writeFile(
    path.join(FIXTURE_DIR, "setup-elefante.txt"),
    "Trova trova davvero elefante nei file locali, nelle immagini associate, negli appunti e nelle preview.",
  );
  await fs.writeFile(
    path.join(FIXTURE_DIR, "setup-piantina.md"),
    "# Piantina ufficio\n\nFixture per tutorial: ricerca visuale, OCR e documenti simili alla piantina caricata.",
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

async function connectToTrovaTab() {
  const tabs = await fetch(`${CDP_URL}/json/list`).then((response) => response.json()).catch((err) => {
    throw new Error(`Chrome DevTools non raggiungibile su ${CDP_URL}: ${err.message || err}`);
  });
  const trovaTabs = tabs.filter((item) => item.url === APP_URL || item.url?.startsWith(APP_URL));
  let tab = trovaTabs[trovaTabs.length - 1];
  if (!tab) {
    await fetch(`${CDP_URL}/json/new?${encodeURIComponent(APP_URL)}`, { method: "PUT" }).catch(() => null);
    const nextTabs = await fetch(`${CDP_URL}/json/list`).then((response) => response.json());
    tab = nextTabs.find((item) => item.url === APP_URL) || nextTabs.find((item) => item.url?.startsWith(APP_URL));
  }
  if (!tab?.webSocketDebuggerUrl) throw new Error(`Tab Trova non trovata su ${APP_URL}.`);
  return createCdpClient(tab.webSocketDebuggerUrl, tab.id);
}

function createCdpClient(webSocketDebuggerUrl, targetId) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const item = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error.message));
    else item.resolve(message.result);
  });
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  async function send(method, params = {}) {
    await opened;
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`CDP timeout ${method}`));
      }, 15_000);
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
  }
  return {
    async enable() {
      await send("Runtime.enable");
      await send("Page.enable");
      await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 255, g: 255, b: 255, a: 1 } });
    },
    async setViewport(width, height, deviceScaleFactor) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor,
        mobile: false,
      });
    },
    async reload() {
      await send("Page.reload", { ignoreCache: true });
      await wait(1400);
    },
    async evaluate(expression) {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluate failed");
      return result.result?.value;
    },
    async waitForText(needle, timeout = 8000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const found = await this.evaluate(`document.body?.innerText.includes(${JSON.stringify(needle)})`);
        if (found) return;
        await wait(220);
      }
      throw new Error(`Text not found: ${needle}`);
    },
    async capture(filePath, selector) {
      if (targetId) await fetch(`${CDP_URL}/json/activate/${targetId}`).catch(() => null);
      await send("Page.bringToFront");
      await wait(1100);
      const clip = selector
        ? await this.evaluate(`(() => {
            const node = document.querySelector(${JSON.stringify(selector)});
            if (!node) return null;
            const rect = node.getBoundingClientRect();
            return {
              x: Math.max(0, Math.floor(rect.x)),
              y: Math.max(0, Math.floor(rect.y)),
              width: Math.max(1, Math.ceil(rect.width)),
              height: Math.max(1, Math.min(900, Math.ceil(rect.height))),
              scale: 1
            };
          })()`)
        : null;
      const result = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: Boolean(clip),
        fromSurface: true,
        ...(clip ? { clip } : {}),
      });
      await fs.writeFile(filePath, Buffer.from(result.data, "base64"));
    },
    close() {
      ws.close();
    },
  };
}

async function searchElephant() {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const input = document.querySelector(".search-box input");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, "elefante");
  input?.dispatchEvent(new Event("input", { bubbles: true }));
  input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
  await wait(700);
}

async function openSettings() {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const button =
    document.querySelector(".title-action") ||
    Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.includes("Impostazioni"));
  button?.click();
  const end = Date.now() + 4000;
  while (Date.now() < end && !document.querySelector(".settings-panel")) {
    await wait(120);
  }
  return Boolean(document.querySelector(".settings-panel"));
}

function pinSettingsForScreenshot() {
  const panel = document.querySelector(".settings-panel");
  if (!(panel instanceof HTMLElement)) return false;
  document.body.style.overflow = "hidden";
  panel.style.position = "fixed";
  panel.style.left = "40px";
  panel.style.right = "40px";
  panel.style.top = "86px";
  panel.style.zIndex = "50";
  panel.style.maxHeight = "calc(100vh - 110px)";
  panel.style.overflow = "hidden";
  panel.style.boxShadow = "0 24px 80px rgba(60, 64, 67, 0.16)";
  return true;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
