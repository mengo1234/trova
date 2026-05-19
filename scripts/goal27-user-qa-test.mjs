import { promises as fs } from "node:fs";
import path from "node:path";
import { assert, command, printChecks, resetFixture, ROOT, watchPath, withLocalApi, withStateRestore } from "./goal-product-helpers.mjs";

await withLocalApi(async () => withStateRestore(async () => {
  const source = await fs.readFile(path.join(ROOT, "src", "main.tsx"), "utf8");
  assert(source.includes("Prepara tutto"), "Utente inesperto vede un solo pulsante principale");
  assert(source.includes("Scegli le cartelle, poi faccio io."), "Tutorial spiega in modo semplice");
  assert(source.includes("Dettagli tecnici"), "Dettagli tecnici restano nascosti ma accessibili");

  const fixture = await resetFixture("goal27-user-qa");
  await fs.writeFile(path.join(fixture, "storia-elefante.txt"), "Questo file parla di un elefante, una foto e un video.");
  await fs.writeFile(path.join(fixture, "foto-elefante.md"), "Immagine associata: elefante nella savana.");
  const paths = [watchPath("goal27", fixture)];
  await command("save_watch_paths", { paths });

  const job = await command("start_auto_setup", { paths, allowSystemChanges: false });
  const finalJob = await waitForJob(job.id);
  assert(finalJob.status === "done", "Utente puo premere Prepara tutto e arrivare a fine setup");

  const results = await command("search_index", { request: { textQuery: "elefante", filters: ["all"], semantic: true, fuzzy: true, limit: 20 } });
  assert(results.length >= 2, "Utente puo cercare elefante e vedere risultati reali");

  const simple = await command("get_simple_app_status", {});
  assert(simple.title && simple.message, "Utente capisce lo stato senza leggere dettagli tecnici");

  await command("stop_watcher", {});
  printChecks();
}));

async function waitForJob(id) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const job = await command("get_auto_setup_status", {});
    if (job.id === id && job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("QA utente inesperto non terminato in tempo");
}
