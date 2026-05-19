import { assert, command, printChecks, withLocalApi, withStateRestore } from "./goal-product-helpers.mjs";

await withLocalApi(() => withStateRestore(async () => {
  const doctor = await command("get_doctor_status", {});
  assert(doctor.summary.required > 0, "Doctor restituisce riepilogo componenti richiesti");
  assert(doctor.checks.some((item) => item.id === "component:tesseract"), "Doctor controlla Tesseract OCR reale");
  assert(doctor.checks.some((item) => item.id === "component:whisper"), "Doctor controlla Whisper locale");
  assert(doctor.checks.some((item) => item.id === "privacy:cloud-opt-in"), "Doctor include privacy cloud opt-in");
  assert(doctor.remoteAccess && doctor.remoteAccess.running === false, "Remote access spento di default");

  const exported = await command("export_diagnostic_log", {});
  assert(exported.ok && exported.path.endsWith("trova-doctor.json"), "Doctor esporta log diagnostico");
  assert(JSON.stringify(exported).toLowerCase().includes("token") === false, "Export response non mostra token");

  printChecks();
}));
