// `pnpm benchmark`: the canonical scorecard generator. Runs every bundled
// eval plus the retrieval benchmark in a scratch schema (never the real
// brain), and writes the combined report to benchmark/report.json (or the
// path in MARROW_REPORT_OUT, which the CI drift gate uses).
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runScorecard, withScratchSchema } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";

async function main(): Promise<void> {
  const scorecard = await withScratchSchema(DATABASE_URL, (scratchUrl) => runScorecard(scratchUrl));
  const { benchmark } = scorecard;
  // top-level benchmark fields stay where they always were, so existing
  // consumers (launch preflight) keep reading the same shape; evals are new.
  const report = { ...benchmark, evals: scorecard.evals };

  const outPath = process.env.MARROW_REPORT_OUT ?? join(repoRoot, "benchmark", "report.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    `Baseline (raw dump): ${benchmark.baseline.tokens} tokens across ${benchmark.baseline.docs} docs`,
  );
  console.log(
    `Marrow (task scoped): ${benchmark.marrow.avgTokens} tokens avg, ${benchmark.marrow.avgLatencyMs}ms avg latency`,
  );
  console.log(`Flat-search ratio: ${benchmark.ratio}x fewer tokens into context`);
  if (benchmark.quality) {
    console.log(
      `Quality: recall@k ${benchmark.quality.recallAtK}, noise ratio ${benchmark.quality.noiseRatio}`,
    );
  }
  if (benchmark.brief) {
    console.log(
      `prepare_task brief: ${benchmark.brief.avgTokens} tokens avg, ratio ${benchmark.brief.ratio}x`,
    );
  }
  const { catch: c, write: w, temporal: t } = scorecard.evals;
  console.log(`Catch eval: precision ${c.precision}, recall ${c.recall}, f1 ${c.f1}`);
  console.log(
    `Write eval: precision ${w.writePrecision}, recall ${w.writeRecall}, false memories ${w.falseMemoryRate}, duplicates ${w.duplicateRate}`,
  );
  console.log(
    `Temporal eval: current-state ${t.currentStateAccuracy}, historical ${t.historicalAccuracy}`,
  );
  console.log(`Wrote ${outPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
