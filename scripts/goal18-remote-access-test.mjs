import { assert, command, printChecks, withLocalApi, withStateRestore } from "./goal-product-helpers.mjs";

await withLocalApi(() => withStateRestore(async () => {
  await command("stop_remote_access", {}).catch(() => null);
  const started = await command("start_remote_access", { config: { bind: "127.0.0.1", port: 18756, allowFileDownload: false } });
  assert(started.running && started.port === 18756, "Remote Access parte su porta configurata");
  assert(started.token, "Remote Access restituisce token solo all'avvio");

  const unauthorized = await fetch("http://127.0.0.1:18756/api/health").then((response) => response.status);
  assert(unauthorized === 401, "Remote Access rifiuta richieste senza token");

  const authorized = await fetch("http://127.0.0.1:18756/api/health", {
    headers: { "x-trova-token": started.token },
  }).then((response) => response.json());
  assert(authorized.ok && authorized.result.remoteAccess.running, "Remote Access accetta token valido");

  const stopped = await command("stop_remote_access", {});
  assert(!stopped.running, "Remote Access si ferma e resta opt-in");

  printChecks();
}));
