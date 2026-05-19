import path from "node:path";
import { readFile } from "node:fs/promises";
import { assert, command, makeFaceLikeImage, printChecks, resetFixture, watchPath, withLocalApi, withStateRestore } from "./goal-product-helpers.mjs";

await withLocalApi(() => withStateRestore(async () => {
  const dir = await resetFixture("goal16-person");
  const queryFace = path.join(dir, "query-persona.png");
  const indexedFace = path.join(dir, "persona-ufficio.png");
  const made = await makeFaceLikeImage(queryFace) && await makeFaceLikeImage(indexedFace);
  if (!made) {
    assert(true, "FFmpeg non disponibile: test persona saltato in modo esplicito");
    printChecks();
    return;
  }

  await command("start_indexing", { paths: [watchPath("goal16", dir)] });
  const dataUrl = `data:image/png;base64,${await readFile(queryFace, "base64")}`;
  const visual = await command("visual_embedding_from_data_url", { dataUrl });
  const face = await command("face_embedding_from_data_url", { dataUrl });
  assert(face.length === visual.length, "Embedding persona locale generato con dimensione compatibile");

  const results = await command("search_index", {
    request: {
      imageQuery: visual,
      imageQueries: [visual],
      faceQuery: face,
      faceQueries: [face],
      mode: "person",
      filters: ["images"],
      limit: 10,
    },
  });
  const match = results.find((item) => item.name === "persona-ufficio.png");
  assert(Boolean(match), "Modalita persona trova immagine con stessa persona esplicita");
  assert(match?.matchType === "person", "Risultato persona dichiara matchType person");

  printChecks();
}));
