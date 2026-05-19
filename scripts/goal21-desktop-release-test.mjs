import { promises as fs } from "node:fs";
import path from "node:path";
import { assert, command, printChecks, ROOT, withLocalApi } from "./goal-product-helpers.mjs";

await withLocalApi(async () => {
  const packaging = await command("get_packaging_status", {});
  assert(packaging.bundle?.productName === "Trova", "Packaging conosce prodotto Trova");
  assert(packaging.checks.some((item) => item.id === "local-api" && item.ok), "Bundle include backend locale");
  assert(packaging.checks.some((item) => item.id === "resources"), "Packaging controlla risorse backend");

  const packageJson = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));
  assert(packageJson.license === "GPL-3.0-or-later", "Licenza compatibile open source dichiarata");
  assert(packageJson.scripts["test:goal12"] && packageJson.scripts["test:goal27"], "Script /goal 12-27 registrati");

  const readme = await fs.readFile(path.join(ROOT, "README.md"), "utf8");
  assert(readme.includes("Remote Access"), "README documenta Remote Access");
  assert(readme.includes("Doctor") || readme.includes("Stato app"), "README documenta stato app diagnostico");

  printChecks();
});
