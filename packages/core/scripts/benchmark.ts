// `pnpm benchmark`: reproducible token + latency benchmark on the hero slice.
// runs from a clean brain, populates it from the fixture corpus, measures
// task-scoped retrieval vs a raw dump, and writes benchmark/report.json.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Marrow, createStore } from "@marrowhq/core";
import pg from "pg";

import {
  type LabeledQuestion,
  type SeedDoc,
  runBenchmark,
  seedBenchmarkBrain,
} from "../src/benchmark.js";
import { createConceptEmbedding } from "../src/demo.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures", "benchmark");
const repoRoot = join(here, "..", "..", "..");
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";

interface CorpusSpec {
  file: string;
  source: string;
  entity: string;
  decisionTitle: string;
  decisionRationale: string;
  question: string;
}

async function main(): Promise<void> {
  const specs = JSON.parse(
    await readFile(join(fixturesDir, "corpus.json"), "utf8"),
  ) as CorpusSpec[];
  const docs: SeedDoc[] = [];
  const labeled: LabeledQuestion[] = [];
  for (const spec of specs) {
    const text = await readFile(join(fixturesDir, spec.file), "utf8");
    docs.push({
      source: spec.source,
      text,
      entity: spec.entity,
      decisionTitle: spec.decisionTitle,
      decisionRationale: spec.decisionRationale,
    });
    labeled.push({
      question: spec.question,
      relevantTitles: [spec.entity, spec.decisionTitle],
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
  // decisions get promoted through the sanctioned answer path so the brief
  // arm measures a brain with decided truth in it.
  await seedBenchmarkBrain(core, docs, { decide: true });
  const report = await runBenchmark(core, {
    corpusTexts: docs.map((d) => d.text),
    labeled,
    k: 4, // recall stays perfect at k=4; k=2 drops labeled nodes (measured)
    measureBrief: true,
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
  console.log(`Flat-search ratio: ${report.ratio}x fewer tokens into context`);
  if (report.quality) {
    console.log(
      `Quality: recall@k ${report.quality.recallAtK}, noise ratio ${report.quality.noiseRatio}`,
    );
  }
  if (report.brief) {
    console.log(
      `prepare_task brief: ${report.brief.avgTokens} tokens avg, ratio ${report.brief.ratio}x`,
    );
  }
  console.log("Wrote benchmark/report.json");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
