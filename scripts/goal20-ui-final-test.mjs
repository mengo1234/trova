import { promises as fs } from "node:fs";
import path from "node:path";
import { assert, printChecks, ROOT } from "./goal-product-helpers.mjs";

const source = await fs.readFile(path.join(ROOT, "src", "main.tsx"), "utf8");
const css = await fs.readFile(path.join(ROOT, "src", "styles.css"), "utf8");

assert(source.includes('label: "Stato app"'), "Settings espone tab Stato app");
assert(source.includes('label: "Altri dispositivi"'), "Settings espone tab altri dispositivi");
assert(source.includes("get_doctor_status"), "UI consuma diagnostica backend reale");
assert(source.includes("get_remote_access_status"), "UI consuma Remote Access backend reale");
assert(source.includes("face_embedding_from_data_url"), "UI prepara embedding persona esplicito");
assert(css.includes(".doctor-check-grid"), "CSS include layout Material per Doctor");
assert(css.includes(".settings-tabs button.active"), "Settings mantiene tab Material 3");

printChecks();
