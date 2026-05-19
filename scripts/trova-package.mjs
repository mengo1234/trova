#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const ROOT = process.cwd();
const args = process.argv.slice(2);
const action = args.find((item) => !item.startsWith("--")) || "preflight";
const asJson = args.includes("--json");
const dryRun = args.includes("--dry-run") || action === "preflight";
const force = args.includes("--force");
const includeAppImage = args.includes("--appimage");

try {
  const status = await packagingPreflight();
  if (action === "preflight" || action === "status") {
    print(status);
  } else if (action === "build") {
    if (!status.ready && !force) {
      throw new Error(`Preflight incompleto: ${status.checks.filter((check) => !check.ok).map((check) => check.label).join(", ")}`);
    }
    const result = dryRun ? { ...status, executed: [] } : await runBuild(status);
    print(result);
  } else {
    throw new Error(`Azione packaging non riconosciuta: ${action}`);
  }
} catch (err) {
  console.error(`Errore packaging: ${err.message || err}`);
  process.exit(1);
}

async function packagingPreflight() {
  const tauriConfig = await readJson(path.join(ROOT, "src-tauri", "tauri.conf.json"), {});
  const icons = Array.isArray(tauriConfig?.bundle?.icon) ? tauriConfig.bundle.icon : [];
  const resources = Array.isArray(tauriConfig?.bundle?.resources) ? tauriConfig.bundle.resources : [];
  const [node, npm, cargo, rustc] = await Promise.all([
    tool("node", "Node.js", "node", ["--version"]),
    tool("npm", "npm", "npm", ["--version"]),
    tool("cargo", "Cargo", "cargo", ["--version"]),
    tool("rustc", "Rust", "rustc", ["--version"]),
  ]);
  const tauriCli = await fileExists(path.join(ROOT, "node_modules", "@tauri-apps", "cli", "tauri.js"));
  const localApi = await fileExists(path.join(ROOT, "scripts", "local-backend.mjs"));
  const iconOk = (await Promise.all(icons.map((item) => fileExists(path.resolve(ROOT, "src-tauri", item))))).some(Boolean);
  const resourceOk = resources.some((item) => String(item).includes("local-backend"));
  const checks = [
    { id: "node", label: "Node.js", ok: node.installed, detail: node.version || node.error },
    { id: "npm", label: "npm", ok: npm.installed, detail: npm.version || npm.error },
    { id: "cargo", label: "Cargo", ok: cargo.installed, detail: cargo.version || cargo.error },
    { id: "rustc", label: "Rust", ok: rustc.installed, detail: rustc.version || rustc.error },
    { id: "tauri-cli", label: "Tauri CLI locale", ok: tauriCli, detail: "node_modules/@tauri-apps/cli" },
    { id: "local-api", label: "API locale completa", ok: localApi, detail: "scripts/local-backend.mjs" },
    { id: "icon", label: "Icona bundle", ok: iconOk, detail: icons.join(", ") || "manca" },
    { id: "resources", label: "Risorse bundle backend", ok: resourceOk, detail: resources.join(", ") || "manca" },
  ];
  const bundleArgs = desktopBundleArgs();
  return {
    action,
    dryRun,
    platform: os.platform(),
    arch: os.arch(),
    root: ROOT,
    ready: checks.every((check) => check.ok),
    checks,
    tools: [node, npm, cargo, rustc],
    bundle: {
      productName: tauriConfig.productName || "Trova",
      version: tauriConfig.version || "0.0.0",
      identifier: tauriConfig.identifier || "",
      targets: tauriConfig?.bundle?.targets || "all",
      icons,
      resources,
      defaultBundles: bundleArgs.slice(2).join(","),
    },
    plan: [
      { label: "Build frontend", command: "npm", args: ["run", "build"] },
      { label: "Build desktop", command: "npm", args: ["run", "tauri", "--", ...bundleArgs] },
    ],
  };
}

function desktopBundleArgs() {
  if (os.platform() === "linux") {
    const bundles = includeAppImage ? "deb,rpm,appimage" : "deb,rpm";
    return ["build", "--bundles", bundles];
  }
  return ["build"];
}

async function runBuild(status) {
  const executed = [];
  for (const step of status.plan) {
    const started = Date.now();
    const { stdout, stderr } = await execFile(step.command, step.args, {
      cwd: ROOT,
      timeout: 1_800_000,
      maxBuffer: 4_000_000,
    });
    executed.push({
      ...step,
      ok: true,
      durationMs: Date.now() - started,
      output: trim(`${stdout || ""}\n${stderr || ""}`),
    });
  }
  return { ...status, executed };
}

async function tool(id, label, binary, toolArgs) {
  // Su Windows molti tool installati via shim sono .cmd/.bat (npm, npx, pnpm, yarn);
  // execFile non li risolve senza estensione. Proviamo in cascata.
  const candidates = os.platform() === "win32"
    ? [`${binary}.cmd`, `${binary}.exe`, `${binary}.bat`, binary]
    : [binary];
  let lastErr;
  for (const candidate of candidates) {
    try {
      const { stdout, stderr } = await execFile(candidate, toolArgs, {
        cwd: ROOT,
        timeout: 8000,
        maxBuffer: 200_000,
        shell: false,
      });
      return {
        id,
        label,
        binary: candidate,
        installed: true,
        version: String(stdout || stderr).split("\n").find(Boolean) || "installato",
        error: "",
      };
    } catch (err) {
      lastErr = err;
    }
  }
  {
    const err = lastErr || new Error("non disponibile");
    return {
      id,
      label,
      binary,
      installed: false,
      version: "",
      error: err.message || String(err),
    };
  }
}

async function fileExists(filePath) {
  return fs.stat(filePath).then((stat) => stat.isFile()).catch(() => false);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function trim(output) {
  const clean = output.replace(/\r/g, "").trim();
  return clean.length > 1800 ? `${clean.slice(0, 800)}\n...\n${clean.slice(-800)}` : clean;
}

function print(value) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log([
    `Trova package preflight: ${value.ready ? "pronto" : "incompleto"} · ${value.platform}/${value.arch}`,
    ...value.checks.map((check) => `${check.ok ? "OK" : "NO"} ${check.label}: ${check.detail}`),
    "",
    "Piano build:",
    ...value.plan.map((step) => `- ${[step.command, ...step.args].join(" ")}`),
    ...(value.executed?.length
      ? [
          "",
          "Eseguito:",
          ...value.executed.map((step) => `- OK ${step.label} (${Math.round(step.durationMs / 1000)}s)`),
        ]
      : []),
  ].join("\n"));
}
