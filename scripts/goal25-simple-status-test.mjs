import { assert, command, printChecks, withLocalApi } from "./goal-product-helpers.mjs";

const forbidden = /\b(Tika|Typesense|CLIP|DINO|SigLIP|embedding|watcher|rclone|token|metadata|cache)\b/i;

await withLocalApi(async () => {
  const status = await command("get_simple_app_status", {});
  assert(["Tutto pronto", "Sto preparando", "Serve conferma", "Qualcosa non va"].includes(status.title), "Stato app usa titoli semplici");
  assert(!forbidden.test(status.title), "Titolo stato senza termini tecnici");
  assert(!forbidden.test(status.message), "Messaggio stato senza termini tecnici");
  for (const issue of status.issues || []) {
    assert(!forbidden.test(`${issue.title} ${issue.message} ${issue.actionLabel}`), `Problema semplice: ${issue.title}`);
  }
  for (const section of status.sections || []) {
    assert(!forbidden.test(`${section.label} ${section.message}`), `Sezione semplice: ${section.label}`);
  }
  assert(status.detailsAvailable, "Dettagli tecnici restano disponibili separatamente");
  printChecks();
});
