#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const ROOT = process.cwd();
await loadLocalReleaseEnv();
await syncUpdaterEndpointFromEnvironment();
const args = process.argv.slice(2);
const action = args.find((item) => !item.startsWith("--")) || "status";
const asJson = args.includes("--json");
const requireSigning = args.includes("--require-signing");
const includeAppImage = args.includes("--appimage") || process.env.TROVA_APPIMAGE === "1";
const releaseUrlBase = process.env.TROVA_RELEASE_URL_BASE || `https://github.com/${process.env.GITHUB_REPOSITORY || "OWNER/REPO"}/releases/download`;
const version = await appVersion();

try {
  if (action === "status" || action === "preflight") {
    const status = await releaseStatus();
    if (requireSigning && !status.signing.ready) {
      throw new Error(`Signing incompleto: ${status.signing.missing.join(", ")}`);
    }
    print(status, formatStatus);
  } else if (action === "manifest") {
    const manifest = await generateUpdaterManifest();
    await fs.mkdir(path.join(ROOT, "dist", "release"), { recursive: true });
    const outputPath = path.join(ROOT, "dist", "release", "latest.json");
    await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
    print({ outputPath, manifest }, formatManifest);
  } else if (action === "build") {
    const status = await releaseStatus();
    if (requireSigning && !status.signing.ready) {
      throw new Error(`Signing incompleto: ${status.signing.missing.join(", ")}`);
    }
    const result = await runReleaseBuild(status);
    print(result, formatBuild);
  } else {
    throw new Error(`Azione release non riconosciuta: ${action}`);
  }
} catch (err) {
  console.error(`Errore release: ${err.message || err}`);
  process.exit(1);
}

async function releaseStatus() {
  const [packageJson, tauriConfig, releaseConfig, workflowExists] = await Promise.all([
    readJson(path.join(ROOT, "package.json"), {}),
    readJson(path.join(ROOT, "src-tauri", "tauri.conf.json"), {}),
    readJson(path.join(ROOT, "src-tauri", "tauri.release.conf.json"), {}),
    fileExists(path.join(ROOT, ".github", "workflows", "release.yml")),
  ]);
  const bundleFiles = await listBundleFiles();
  const platform = os.platform();
  const signing = signingStatus(platform);
  const checks = [
    { id: "release-conf", label: "Config release updater", ok: releaseConfig?.bundle?.createUpdaterArtifacts === true, detail: "src-tauri/tauri.release.conf.json" },
    { id: "entitlements", label: "Entitlements macOS", ok: await fileExists(path.join(ROOT, "src-tauri", "entitlements.plist")), detail: "src-tauri/entitlements.plist" },
    { id: "workflow", label: "Workflow multi-OS", ok: workflowExists, detail: ".github/workflows/release.yml" },
    { id: "package-script", label: "Script release npm", ok: Boolean(packageJson.scripts?.["release:status"] && packageJson.scripts?.["release:manifest"]), detail: "package.json" },
    { id: "icon", label: "Icona bundle", ok: await bundleIconConfigured(tauriConfig), detail: (tauriConfig.bundle?.icon || []).join(", ") },
    { id: "appimage-mode", label: "AppImage opzionale isolato", ok: true, detail: includeAppImage ? "appimage abilitata" : "default stabile deb,rpm" },
  ];
  return {
    version,
    platform,
    arch: os.arch(),
    root: ROOT,
    bundle: {
      productName: tauriConfig.productName || "Trova",
      identifier: tauriConfig.identifier || "",
      releaseUpdaterArtifacts: releaseConfig?.bundle?.createUpdaterArtifacts === true,
      files: bundleFiles,
    },
    signing,
    checks,
    ready: checks.every((check) => check.ok),
    releaseReady: checks.every((check) => check.ok) && (!requireSigning || signing.ready),
    commands: {
      preflight: "npm run release:status",
      manifest: "npm run release:manifest",
      localLinux: `npm run tauri -- ${releaseBuildArgs(signing).join(" ")}`,
    },
  };
}

function signingStatus(platform) {
  const updater = Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY || process.env.TAURI_SIGNING_PRIVATE_KEY_PATH);
  const github = Boolean(process.env.GITHUB_TOKEN);
  const macos = Boolean(
    process.env.APPLE_CERTIFICATE &&
    process.env.APPLE_CERTIFICATE_PASSWORD &&
    (
      (process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER) ||
      (process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID)
    )
  );
  const windows = Boolean(
    (process.env.WINDOWS_CERTIFICATE && process.env.WINDOWS_CERTIFICATE_PASSWORD) ||
    process.env.WINDOWS_CERTIFICATE_THUMBPRINT ||
    process.env.WINDOWS_SIGN_COMMAND
  );
  const linux = updater;
  const requiredForPlatform = platform === "darwin"
    ? ["tauri-updater", "macos-notarization"]
    : platform === "win32"
      ? ["tauri-updater", "windows-codesign"]
      : ["tauri-updater"];
  const availability = {
    "tauri-updater": updater,
    "github-token": github,
    "macos-notarization": macos,
    "windows-codesign": windows,
    "linux-updater": linux,
  };
  const missing = requiredForPlatform.filter((item) => !availability[item]);
  return {
    ready: missing.length === 0,
    updater,
    github,
    macos,
    windows,
    linux,
    requiredForPlatform,
    missing,
    expectedSecrets: {
      updater: ["TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"],
      updaterLocal: ["TAURI_SIGNING_PRIVATE_KEY_PATH", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"],
      macos: ["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"],
      windows: ["WINDOWS_CERTIFICATE", "WINDOWS_CERTIFICATE_PASSWORD", "WINDOWS_CERTIFICATE_THUMBPRINT", "WINDOWS_SIGN_COMMAND"],
      github: ["GITHUB_TOKEN"],
    },
  };
}

async function runReleaseBuild(status) {
  const bundleArgs = releaseBuildArgs(status.signing);
  const steps = [
    { label: "Build frontend", command: "npm", args: ["run", "build"] },
    { label: "Build desktop release", command: "npm", args: ["run", "tauri", "--", ...bundleArgs] },
  ];
  const executed = [];
  for (const step of steps) {
    const started = Date.now();
    const result = await runStep(step);
    executed.push({ ...step, ...result, durationMs: Date.now() - started });
    if (!result.ok) break;
  }
  return {
    ...status,
    executed,
    artifacts: await listBundleFiles(),
  };
}

function releaseBuildArgs(signing) {
  const bundleArgs = os.platform() === "linux"
    ? ["build", "--bundles", includeAppImage ? "deb,rpm,appimage" : "deb,rpm"]
    : ["build"];
  if (signing.updater || requireSigning) {
    bundleArgs.push("--config", "src-tauri/tauri.release.conf.json");
  }
  return bundleArgs;
}

async function runStep(step) {
  try {
    const { stdout, stderr } = await execFile(step.command, step.args, {
      cwd: ROOT,
      timeout: 1_800_000,
      maxBuffer: 5_000_000,
      env: process.env,
    });
    return { ok: true, output: trimOutput(`${stdout || ""}\n${stderr || ""}`) };
  } catch (err) {
    return { ok: false, output: trimOutput(`${err.stdout || ""}\n${err.stderr || ""}\n${err.message || err}`) };
  }
}

async function generateUpdaterManifest() {
  const files = await listBundleFiles();
  const platforms = {};
  for (const file of files) {
    const platformKey = platformKeyForArtifact(file.path);
    if (!platformKey) continue;
    platforms[platformKey] = {
      signature: await readSignature(file.path),
      url: artifactUrl(file.path),
    };
  }
  return {
    version,
    notes: process.env.TROVA_RELEASE_NOTES || `Trova ${version}`,
    pub_date: new Date().toISOString(),
    platforms,
    artifacts: files.map((file) => ({
      path: file.path,
      fileName: path.basename(file.path),
      size: file.size,
      sha256: file.sha256,
      signature: file.signature,
    })),
  };
}

async function listBundleFiles() {
  const root = path.join(ROOT, "src-tauri", "target", "release", "bundle");
  const extensions = new Set([".deb", ".rpm", ".AppImage", ".msi", ".exe", ".dmg", ".app.tar.gz"]);
  const out = [];
  for (const filePath of await walk(root)) {
    if (![...extensions].some((extension) => filePath.endsWith(extension))) continue;
    const stat = await fs.stat(filePath);
    out.push({
      path: path.relative(ROOT, filePath),
      size: stat.size,
      sha256: await sha256(filePath),
      signature: await readSignature(filePath),
    });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

async function walk(root) {
  const out = [];
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    const items = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const item of items) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) queue.push(full);
      else if (item.isFile()) out.push(full);
    }
  }
  return out;
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return hash.digest("hex");
}

async function readSignature(relativeOrAbsPath) {
  const absolute = path.isAbsolute(relativeOrAbsPath) ? relativeOrAbsPath : path.join(ROOT, relativeOrAbsPath);
  const signaturePath = `${absolute}.sig`;
  return fs.readFile(signaturePath, "utf8").then((value) => value.trim()).catch(() => "");
}

function platformKeyForArtifact(relativePath) {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".deb") || lower.endsWith(".rpm") || lower.endsWith(".appimage")) return `linux-${os.arch() === "arm64" ? "aarch64" : "x86_64"}`;
  if (lower.endsWith(".msi") || lower.endsWith(".exe")) return `windows-${os.arch() === "arm64" ? "aarch64" : "x86_64"}`;
  if (lower.endsWith(".dmg") || lower.endsWith(".app.tar.gz")) return `darwin-${os.arch() === "arm64" ? "aarch64" : "x86_64"}`;
  return "";
}

function artifactUrl(relativePath) {
  const tag = process.env.GITHUB_REF_NAME || `v${version}`;
  return `${releaseUrlBase}/${tag}/${encodeURIComponent(path.basename(relativePath))}`;
}

async function bundleIconConfigured(tauriConfig) {
  const icons = Array.isArray(tauriConfig?.bundle?.icon) ? tauriConfig.bundle.icon : [];
  const results = await Promise.all(icons.map((item) => fileExists(path.resolve(ROOT, "src-tauri", item))));
  return results.some(Boolean);
}

async function appVersion() {
  const packageJson = await readJson(path.join(ROOT, "package.json"), {});
  const tauriConfig = await readJson(path.join(ROOT, "src-tauri", "tauri.conf.json"), {});
  return tauriConfig.version || packageJson.version || "0.0.0";
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function loadLocalReleaseEnv() {
  const envPath = path.join(ROOT, ".trova", "release", "release.env");
  const content = await fs.readFile(envPath, "utf8").catch(() => "");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const splitAt = trimmed.indexOf("=");
    if (splitAt < 1) continue;
    const key = trimmed.slice(0, splitAt).trim();
    const value = trimmed.slice(splitAt + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function syncUpdaterEndpointFromEnvironment() {
  const endpoint = process.env.TROVA_UPDATER_ENDPOINT ||
    (process.env.GITHUB_REPOSITORY
      ? `https://github.com/${process.env.GITHUB_REPOSITORY}/releases/latest/download/latest.json`
      : "");
  if (!endpoint) return;
  const configPath = path.join(ROOT, "src-tauri", "tauri.release.conf.json");
  const config = await readJson(configPath, null);
  if (!config?.plugins?.updater) return;
  const endpoints = config.plugins.updater.endpoints || [];
  if (endpoints.length && !endpoints.some((item) => String(item).includes("OWNER/REPO"))) return;
  config.plugins.updater.endpoints = [endpoint];
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

async function fileExists(filePath) {
  return fs.stat(filePath).then((stat) => stat.isFile()).catch(() => false);
}

function trimOutput(output) {
  const clean = String(output).replace(/\r/g, "").trim();
  return clean.length > 2200 ? `${clean.slice(0, 1000)}\n...\n${clean.slice(-1000)}` : clean;
}

function print(value, formatter) {
  if (asJson) console.log(JSON.stringify(value, null, 2));
  else console.log(formatter(value));
}

function formatStatus(status) {
  return [
    `Release: ${status.ready ? "pronta" : "incompleta"} · ${status.bundle.productName} ${status.version} · ${status.platform}/${status.arch}`,
    ...status.checks.map((check) => `${check.ok ? "OK" : "NO"} ${check.label}: ${check.detail}`),
    `Signing: ${status.signing.ready ? "pronto" : `manca ${status.signing.missing.join(", ") || "n/d"}`}`,
    `Artifact trovati: ${status.bundle.files.length}`,
  ].join("\n");
}

function formatManifest(result) {
  return [
    `Manifest update scritto: ${result.outputPath}`,
    `Piattaforme: ${Object.keys(result.manifest.platforms).join(", ") || "nessuna"}`,
    `Artifact: ${result.manifest.artifacts.length}`,
  ].join("\n");
}

function formatBuild(result) {
  return [
    `Release build: ${result.executed.every((step) => step.ok) ? "ok" : "non completo"}`,
    ...result.executed.map((step) => `${step.ok ? "OK" : "NO"} ${step.label} (${Math.round(step.durationMs / 1000)}s)`),
    `Artifact: ${result.artifacts.map((item) => item.path).join(", ") || "nessuno"}`,
  ].join("\n");
}
