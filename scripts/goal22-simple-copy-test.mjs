import { promises as fs } from "node:fs";
import path from "node:path";
import { assert, printChecks, ROOT } from "./goal-product-helpers.mjs";

const source = await fs.readFile(path.join(ROOT, "src", "main.tsx"), "utf8");

const simpleLabels = [
  'label: "Preparazione"',
  'label: "Stato app"',
  'label: "Foto e video"',
  'label: "Archivi esterni"',
  'label: "Online"',
  'label: "Dettagli tecnici"',
  "Prepara tutto",
  "Scegli le cartelle, poi faccio io.",
];

for (const label of simpleLabels) {
  assert(source.includes(label), `UI semplice contiene ${label}`);
}

for (const oldLabel of ['label: "Componenti"', 'label: "Doctor"', 'label: "Vision"', 'label: "Remote"', 'label: "Cloud"', 'label: "Accesso"', 'label: "Avanzate"']) {
  assert(!source.includes(oldLabel), `UI semplice non espone piu ${oldLabel}`);
}

printChecks();
