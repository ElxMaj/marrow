// `pnpm demo`: the hero slice end to end. ingests the design-partner interview,
// distills it, answers the loop, and shows the soft-delete decision decided with
// provenance back to the exact interview line. leaves the brain populated so the
// MCP server and web view can be pointed at it.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Marrow, createStore } from "@marrowhq/core";
import pg from "pg";

import { createDemoEmbedding, createDemoModel, runDemo } from "../src/demo.js";

const here = dirname(fileURLToPath(import.meta.url));
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";

async function main(): Promise<void> {
  const interview = await readFile(
    join(here, "..", "fixtures", "demo", "design-partner.md"),
    "utf8",
  );

  const admin = new pg.Pool({ connectionString: DATABASE_URL });
  await admin.query(
    "truncate provenance, embedding, entity, decision, question, goal restart identity cascade",
  );
  await admin.end();

  const core = new Marrow(createStore(DATABASE_URL), createDemoModel(), createDemoEmbedding());
  const result = await runDemo(core, interview);
  await core.close();

  const d = result.decision;
  const span =
    result.trace.spans.find((s) => s.source.includes("design-partner")) ?? result.trace.spans[0];

  console.log("\n— Marrow hero slice —\n");
  console.log("1. Ingested interviews/design-partner.md and distilled it");
  console.log("2. The loop raised a question; the developer answered it");
  console.log(`3. Decision  [${d.status}]  ${d.title}`);
  console.log(`   Confidence ${d.confidence.value} (${d.confidence.source})`);
  console.log("4. trace_to_source:");
  console.log(`   ${span?.source}`);
  console.log(`   "${span?.spanText}"`);
  console.log(
    `5. An agent asking "why soft delete" over MCP gets ${result.answer.length} task-scoped result(s), each with status + provenance`,
  );
  console.log(`   Still open: ${result.openQuestions.length} question(s), e.g. backup retention`);
  console.log("\nThe decision is decided and it traces to the exact interview line.\n");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
