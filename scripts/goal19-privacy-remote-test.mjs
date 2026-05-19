import path from "node:path";
import { promises as fs } from "node:fs";
import { assert, command, printChecks, resetFixture, watchPath, withLocalApi, withStateRestore } from "./goal-product-helpers.mjs";

await withLocalApi(() => withStateRestore(async () => {
  const dir = await resetFixture("goal19-privacy");
  await fs.writeFile(path.join(dir, "solo-locale.txt"), "Questo file resta locale e non deve diventare candidato Gemini.");
  await fs.writeFile(path.join(dir, "cloud-esplicito.txt"), "Questo file puo essere candidato Gemini solo con toggle cartella.");

  await command("start_indexing", {
    paths: [
      watchPath("goal19-local", dir, { geminiEnabled: false }),
    ],
  });
  const localCandidates = await command("list_gemini_candidates", {});
  assert(localCandidates.length === 0, "Senza toggle Gemini nessun file diventa candidato cloud");

  await command("start_indexing", {
    paths: [
      watchPath("goal19-cloud", dir, { geminiEnabled: true }),
    ],
  });
  const cloudCandidates = await command("list_gemini_candidates", {});
  assert(cloudCandidates.some((item) => item.name === "cloud-esplicito.txt"), "Con toggle Gemini i file supportati diventano candidati espliciti");

  const rclone = await command("get_rclone_status", {});
  assert(rclone.providers.some((item) => item.id === "drive") && rclone.providers.some((item) => item.id === "sftp"), "Remote storage espone cloud e network provider opt-in");

  printChecks();
}));
