import { assert, command, printChecks, withLocalApi, withStateRestore } from "./goal-product-helpers.mjs";

await withLocalApi(async () => withStateRestore(async () => {
  const job = await command("repair_app", { allowSystemChanges: false });
  assert(job.status === "running", "Sistema avvia riparazione automatica");
  assert(job.repair === true, "Job marcato come riparazione");

  const finalJob = await waitForJob(job.id);
  assert(finalJob.status === "done", "Riparazione automatica termina");
  assert(finalJob.steps.some((step) => step.id === "prepare"), "Riparazione prova a sistemare strumenti");

  const simple = await command("get_simple_app_status", {});
  assert(simple.actionLabel, "Stato semplice espone azione principale");
  await command("stop_watcher", {}).catch(() => {});
  printChecks();
}));

async function waitForJob(id) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const job = await command("get_auto_setup_status", {});
    if (job.id === id && job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Riparazione non terminata in tempo");
}
