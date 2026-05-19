import { assert, command, printChecks, withLocalApi, withStateRestore } from "./goal-product-helpers.mjs";

await withLocalApi(async () => withStateRestore(async () => {
  const job = await command("install_everything", { allowSystemChanges: false });
  assert(job.status === "running", "install_everything usa il job automatico");
  assert(job.plan?.runtimeDir?.includes(".trova/runtime"), "Piano dichiara runtime locale");
  assert(job.plan.steps.some((step) => step.label === "Preparo gli strumenti"), "Piano contiene preparazione strumenti");

  const finalJob = await waitForJob(job.id);
  assert(finalJob.status === "done", "Installer automatico termina in modalita test");

  const simple = await command("get_simple_app_status", {});
  assert(Array.isArray(simple.components), "Stato semplice espone preparazione componenti");
  assert(simple.components.every((item) => !/Tika|Typesense|CLIP|DINO|SigLIP|rclone/i.test(item.label)), "Card semplici non mostrano nomi tecnici");

  await command("stop_watcher", {}).catch(() => {});
  printChecks();
}));

async function waitForJob(id) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const job = await command("get_auto_setup_status", {});
    if (job.id === id && job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Installazione automatica non terminata in tempo");
}
