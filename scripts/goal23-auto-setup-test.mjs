import { promises as fs } from "node:fs";
import path from "node:path";
import { assert, command, printChecks, resetFixture, watchPath, withLocalApi, withStateRestore } from "./goal-product-helpers.mjs";

await withLocalApi(async () => withStateRestore(async () => {
  const fixture = await resetFixture("goal23-auto-setup");
  await fs.writeFile(path.join(fixture, "elefante.txt"), "Un elefante blu cammina vicino al lago.");
  await fs.writeFile(path.join(fixture, "note.md"), "# Appunti\nfoto, video e documenti locali");
  const paths = [watchPath("goal23", fixture)];
  await command("save_watch_paths", { paths });

  const job = await command("start_auto_setup", { paths, allowSystemChanges: false });
  assert(job.status === "running", "Prepara tutto avvia un job reale");
  assert(job.plan.steps.some((step) => step.label === "Leggo i file scelti"), "Piano contiene lettura file");

  const finalJob = await waitForJob(job.id);
  assert(finalJob.status === "done", "Setup automatico termina");

  const status = await command("get_index_status", {});
  assert(status.filesIndexed >= 2, "Setup crea la ricerca sui file reali");
  assert(status.watcherActive, "Setup avvia aggiornamenti automatici");

  const results = await command("search_index", { request: { textQuery: "elefante", filters: ["all"], limit: 10 } });
  assert(results.some((item) => item.name === "elefante.txt"), "Dopo setup la ricerca trova elefante");

  await command("stop_watcher", {});
  printChecks();
}));

async function waitForJob(id) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const job = await command("get_auto_setup_status", {});
    if (job.id === id && job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Setup automatico non terminato in tempo");
}
