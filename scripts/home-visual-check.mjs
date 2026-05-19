import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const APP_URL = process.env.TROVA_UI_URL || "http://127.0.0.1:1420/";
const CDP_URL = process.env.TROVA_CDP_URL || "http://127.0.0.1:9222";
const OUT_DIR = path.join(ROOT, ".trova", "visual-check");
const FRAMES = [
  ["morning", 0],
  ["rain", 18000],
  ["sunset", 14000],
  ["night", 14000],
];

await fs.mkdir(OUT_DIR, { recursive: true });

const client = await connectToTrovaTab();
try {
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await client.eval(`
    window.localStorage.setItem("trova.setupComplete", "true");
    window.location.href = ${JSON.stringify(APP_URL)};
  `);
  await wait(900);

  const framePaths = [];
  for (const [name, delay] of FRAMES) {
    if (delay) await wait(delay);
    const filePath = path.join(OUT_DIR, `home-svg-${name}.png`);
    await client.screenshot(filePath);
    framePaths.push(filePath);
  }

  const sheetPath = path.join(OUT_DIR, "home-svg-animated-contact-sheet.png");
  await makeContactSheet(framePaths, sheetPath);
  console.log(JSON.stringify({ sheetPath, framePaths }, null, 2));
} finally {
  client.close();
}

async function connectToTrovaTab() {
  const tabs = await fetch(`${CDP_URL}/json/list`).then((response) => response.json());
  let tab = tabs.find((item) => item.url === APP_URL) || tabs.find((item) => item.url?.startsWith(APP_URL));
  if (!tab) {
    await fetch(`${CDP_URL}/json/new?${encodeURIComponent(APP_URL)}`, { method: "PUT" }).catch(() => null);
    const nextTabs = await fetch(`${CDP_URL}/json/list`).then((response) => response.json());
    tab = nextTabs.find((item) => item.url === APP_URL) || nextTabs.find((item) => item.url?.startsWith(APP_URL));
  }
  if (!tab?.webSocketDebuggerUrl) throw new Error(`Tab Trova non trovata su ${APP_URL}.`);
  return createCdpClient(tab.webSocketDebuggerUrl);
}

function createCdpClient(webSocketDebuggerUrl) {
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
  return {
    async send(method, params = {}) {
      await opened;
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    async eval(expression) {
      const result = await this.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluate failed");
      return result.result?.value;
    },
    async screenshot(filePath) {
      const result = await this.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      await fs.writeFile(filePath, Buffer.from(result.data, "base64"));
    },
    close() {
      ws.close();
    },
  };
}

async function makeContactSheet(files, outPath) {
  const thumbs = await Promise.all(files.map(async (file) => sharp(file).resize(620, 436, { fit: "cover", position: "top" }).png().toBuffer()));
  const width = 1280;
  const tileWidth = 620;
  const tileHeight = 436;
  const gap = 20;
  const rows = Math.ceil(thumbs.length / 2);
  const height = rows * tileHeight + (rows + 1) * gap;
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: "#f8fafd",
    },
  })
    .composite(
      thumbs.map((input, index) => ({
        input,
        left: gap + (index % 2) * (tileWidth + gap),
        top: gap + Math.floor(index / 2) * (tileHeight + gap),
      })),
    )
    .png()
    .toFile(outPath);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
