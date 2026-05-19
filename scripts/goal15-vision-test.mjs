import path from "node:path";
import { readFile } from "node:fs/promises";
import { assert, command, makeColorImage, printChecks, resetFixture, watchPath, withLocalApi, withStateRestore } from "./goal-product-helpers.mjs";

await withLocalApi(() => withStateRestore(async () => {
  const dir = await resetFixture("goal15-vision");
  const queryImage = path.join(dir, "query-green.png");
  const indexedImage = path.join(dir, "piantina-green.png");
  const made = await makeColorImage(queryImage, "green") && await makeColorImage(indexedImage, "green");
  if (!made) {
    assert(true, "FFmpeg non disponibile: test vision saltato in modo esplicito");
    printChecks();
    return;
  }

  await command("start_indexing", { paths: [watchPath("goal15", dir)] });
  const vector = await command("visual_embedding_from_data_url", {
    dataUrl: `data:image/png;base64,${await readFile(queryImage, "base64")}`,
  });
  const results = await command("search_index", {
    request: { imageQuery: vector, imageQueries: [vector], mode: "image", filters: ["images"], limit: 10 },
  });
  const match = results.find((item) => item.name === "piantina-green.png");
  assert(Boolean(match), "Ricerca immagine trova asset visivo simile");
  assert(match?.matchType === "visual", "Risultato immagine usa matchType visual");
  assert(match?.previewKind === "image", "Risultato espone previewKind image");

  printChecks();
}));
