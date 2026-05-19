import path from "node:path";
import { assert, command, makeShortVideo, printChecks, resetFixture, watchPath, withLocalApi, withStateRestore } from "./goal-product-helpers.mjs";

await withLocalApi(() => withStateRestore(async () => {
  const dir = await resetFixture("goal17-media");
  const video = path.join(dir, "scena-colori.mp4");
  const made = await makeShortVideo(video);
  if (!made) {
    assert(true, "FFmpeg non disponibile: test video saltato in modo esplicito");
    printChecks();
    return;
  }

  await command("start_indexing", { paths: [watchPath("goal17", dir)] });
  const context = await command("get_file_context", { request: { filePath: video } });
  assert(context.kind === "video", "Video indicizzato come media video");
  assert(context.visualAssets.some((item) => item.assetKind === "video-keyframe"), "Video produce keyframe indicizzabili");

  const search = await command("search_index", {
    request: { textQuery: "scena colori", mode: "text", filters: ["video"], limit: 10 },
  });
  assert(search.some((item) => item.name === "scena-colori.mp4"), "Video cercabile tramite nome/metadati/transcript fallback");

  printChecks();
}));
