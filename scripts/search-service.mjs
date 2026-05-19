import { spawnSync } from "node:child_process";

const action = process.argv[2];
const actions = new Map([
  ["up", ["up", "-d"]],
  ["down", ["down"]],
  ["logs", ["logs", "-f"]],
]);

if (!actions.has(action)) {
  console.error("Uso: node scripts/search-service.mjs <up|down|logs>");
  process.exit(1);
}

const composeArgs = ["-f", "docker-compose.search.yml", ...actions.get(action)];
const candidates = [
  {
    command: "host-spawn",
    args: ["podman", "compose", ...composeArgs],
    health: ["host-spawn", ["podman", "ps"]],
  },
  {
    command: "flatpak-spawn",
    args: ["--host", "podman", "compose", ...composeArgs],
    health: ["flatpak-spawn", ["--host", "podman", "ps"]],
  },
  {
    command: "docker",
    args: ["compose", ...composeArgs],
    health: ["docker", ["ps"]],
  },
  {
    command: "podman",
    args: ["compose", ...composeArgs],
    health: ["podman", ["ps"]],
  },
  {
    command: "podman-compose",
    args: ["-f", "docker-compose.search.yml", ...actions.get(action)],
    health: ["podman", ["ps"]],
  },
];

for (const candidate of candidates) {
  const { command, args, health } = candidate;
  const available = spawnSync("bash", ["-lc", `command -v ${command}`], { stdio: "ignore" });
  if (available.status !== 0) continue;

  const healthy = spawnSync(health[0], health[1], { stdio: "ignore" });
  if (healthy.status !== 0) continue;

  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  process.exit(result.status ?? 1);
}

console.error("Nessun runtime container funzionante trovato. Installa Docker oppure Podman.");
process.exit(1);
