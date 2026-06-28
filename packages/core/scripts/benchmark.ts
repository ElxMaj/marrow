// `pnpm benchmark`: reproducible token + latency benchmark on the hero slice.
// runs from a clean brain, populates it from the fixture corpus, measures
// task-scoped retrieval vs a raw dump, and writes benchmark/report.json.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Marrow, createStore } from "@marrowhq/core";
import pg from "pg";

import { type SeedDoc, runBenchmark, seedBenchmarkBrain } from "../src/benchmark.js";
import { createConceptEmbedding } from "../src/demo.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures", "benchmark");
const repoRoot = join(here, "..", "..", "..");
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";

const specs = [
  {
    file: "pfc-gdynia.md",
    source: "interviews/pfc-gdynia.md",
    entity: "magic link auth",
    decisionTitle: "Auth uses magic links, no shared passwords",
    decisionRationale: "shared desk terminal, passwords ended up on post-its",
  },
  {
    file: "sessions.md",
    source: "standups/sessions.md",
    entity: "session lifetime",
    decisionTitle: "Sessions expire after 8 hours, lock at 15 minutes idle",
    decisionRationale: "shared terminal, walk-away risk",
  },
  {
    file: "billing.md",
    source: "notes/billing.md",
    entity: "billing webhooks",
    decisionTitle: "Billing webhooks retry with backoff, idempotent by event id",
    decisionRationale: "provider retries cause duplicate deliveries",
  },
];

async function main(): Promise<void> {
  const docs: SeedDoc[] = [];
  for (const spec of specs) {
    const text = await readFile(join(fixturesDir, spec.file), "utf8");
    docs.push({
      source: spec.source,
      text,
      entity: spec.entity,
      decisionTitle: spec.decisionTitle,
      decisionRationale: spec.decisionRationale,
    });
  }

  // reset the distilled layer for a reproducible run (evidence stays append only).
  const admin = new pg.Pool({ connectionString: DATABASE_URL });
  await admin.query(
    "truncate provenance, embedding, entity, decision, question, goal restart identity cascade",
  );
  await admin.end();

  // a deterministic, offline embedding so the report is reproducible without an
  // API key; the read path it exercises (embed query -> cosine over node
  // embeddings) is the same one a real provider drives.
  const core = new Marrow(createStore(DATABASE_URL), undefined, createConceptEmbedding());
  await seedBenchmarkBrain(core, docs);
  const report = await runBenchmark(core, {
    corpusTexts: docs.map((d) => d.text),
    questions: docs.map((d) => d.entity),
    k: 2, // a real task-scoped slice, not the whole 6-node graph
  });
  await core.close();

  const outDir = join(repoRoot, "benchmark");
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    `Baseline (raw dump): ${report.baseline.tokens} tokens across ${report.baseline.docs} docs`,
  );
  console.log(
    `Marrow (task scoped): ${report.marrow.avgTokens} tokens avg, ${report.marrow.avgLatencyMs}ms avg latency`,
  );
  console.log(`Ratio: ${report.ratio}x fewer tokens into context`);
  console.log("Wrote benchmark/report.json");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
