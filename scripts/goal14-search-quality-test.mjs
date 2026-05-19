import path from "node:path";
import { promises as fs } from "node:fs";
import { assert, command, printChecks, resetFixture, watchPath, withLocalApi, withStateRestore } from "./goal-product-helpers.mjs";

await withLocalApi(() => withStateRestore(async () => {
  const dir = await resetFixture("goal14-search-quality");
  await fs.writeFile(path.join(dir, "elefante-documento.txt"), "Un elefante attraversa una piantina tecnica con note OCR, metadata e ricerca fuzzy.");
  await fs.writeFile(path.join(dir, "giraffa-documento.txt"), "Una giraffa serve come controllo negativo per il ranking locale.");

  await command("start_indexing", { paths: [watchPath("goal14", dir)] });

  const fuzzy = await command("search_index", {
    request: { textQuery: "elefnate piantina", mode: "text", filters: ["all"], fuzzy: true, semantic: true, limit: 10 },
  });
  const top = fuzzy[0];
  assert(top?.name === "elefante-documento.txt", "Ranking ibrido mette il documento elefante in testa");
  assert(top.matchType === "text" || top.matchType === "fuzzy" || top.matchType === "semantic", "Risultato dichiara matchType testuale");
  assert(top.rankBreakdown && typeof top.rankBreakdown === "object", "Risultato espone rankBreakdown");
  assert(fuzzy.length <= 10, "Search rispetta limit richiesta");

  const ask = await command("ask_files", { request: { question: "Dove compare elefante nella piantina?", limit: 4 } });
  assert(ask.citations.some((item) => item.title === "elefante-documento.txt"), "Ask locale cita il file giusto");

  printChecks();
}));
