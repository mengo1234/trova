// Compila scripts/local-backend.mjs in un binario nativo platform-specific
// usando Bun (`bun build --compile`). Output: src-tauri/binaries/trova-backend-<target>.
// In questo modo non serve Node installato sulla macchina dell'utente: il binary
// e bundled come Tauri sidecar (externalBin in tauri.conf.json).

import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const ROOT = process.cwd();
const SOURCE = path.join(ROOT, "scripts", "local-backend.mjs");
const OUT_DIR = path.join(ROOT, "src-tauri", "binaries");

function tripleForCurrentPlatform() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "darwin") {
    return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  if (platform === "win32") {
    return arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  }
  // linux
  return arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
}

function bunTargetForTriple(triple) {
  if (triple.startsWith("x86_64-apple-darwin")) return "bun-darwin-x64";
  if (triple.startsWith("aarch64-apple-darwin")) return "bun-darwin-arm64";
  if (triple.startsWith("x86_64-pc-windows-msvc")) return "bun-windows-x64";
  if (triple.startsWith("aarch64-pc-windows-msvc")) {
    // Bun non ha ancora target windows-arm64; fallback al binario nativo del runner.
    return null;
  }
  if (triple.startsWith("x86_64-unknown-linux-gnu")) return "bun-linux-x64";
  if (triple.startsWith("aarch64-unknown-linux-gnu")) return "bun-linux-arm64";
  return null;
}

async function ensureBunAvailable() {
  try {
    const { stdout } = await execFile("bun", ["--version"], { timeout: 5000 });
    return stdout.trim();
  } catch {
    throw new Error("Bun non trovato nel PATH. Installalo da https://bun.sh prima di buildare il backend.");
  }
}

async function main() {
  await ensureBunAvailable();
  await fs.mkdir(OUT_DIR, { recursive: true });

  const triple = process.env.TARGET_TRIPLE || tripleForCurrentPlatform();
  const bunTarget = bunTargetForTriple(triple);
  const isWindows = triple.includes("windows");
  const ext = isWindows ? ".exe" : "";
  // Tauri externalBin si aspetta `<name>-<target_triple>` come filename
  const outFile = path.join(OUT_DIR, `trova-backend-${triple}${ext}`);

  const args = ["build", "--compile", SOURCE, "--outfile", outFile];
  if (bunTarget) args.push(`--target=${bunTarget}`);

  console.log(`[backend-binary] target triple: ${triple}`);
  console.log(`[backend-binary] bun target: ${bunTarget || "(auto host)"}`);
  console.log(`[backend-binary] output: ${outFile}`);
  console.log(`[backend-binary] bun ${args.join(" ")}`);
  const { stdout, stderr } = await execFile("bun", args, {
    cwd: ROOT,
    timeout: 5 * 60 * 1000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  const stat = await fs.stat(outFile);
  console.log(`[backend-binary] OK ${outFile} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((err) => {
  console.error("[backend-binary] FAILED:", err.message || err);
  process.exit(1);
});
