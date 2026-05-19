import { assert, command, printChecks, withLocalApi, withStateRestore } from "./goal-product-helpers.mjs";

await withLocalApi(() => withStateRestore(async () => {
  const components = await command("get_local_components", {});
  assert(components.some((item) => item.id === "desktop-runtime"), "Componenti espongono runtime desktop");
  assert(components.every((item) => item.actionLabel && item.installHint), "Ogni componente ha azione e hint reali");
  assert(components.filter((item) => !item.installed).every((item) => item.installable !== undefined), "Componenti mancanti dichiarano se installabili");

  const preflight = await command("install_local_component", { id: "desktop-runtime" });
  assert(preflight.steps?.some((step) => step.label.includes("Controllo packaging")), "Installer runtime esegue preflight reale");
  assert(Array.isArray(preflight.components) && preflight.components.length > 0, "Installer restituisce stato componenti aggiornato");

  const models = await command("get_model_status", {});
  assert(models.text.primaryModel && models.face.model, "Model status espone testo e persona locale");

  printChecks();
}));
