import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  type BenchmarkReport,
  type LabeledQuestion,
  type SeedDoc,
  runBenchmark,
  seedBenchmarkBrain,
} from "./benchmark.js";
import { createConceptEmbedding } from "./demo.js";
import { loadSyntheticGolden, runEval } from "./eval.js";
import { loadTemporalGolden, runTemporalEval } from "./eval-temporal.js";
import { createReplayModel, loadWriteGolden, runWriteEval } from "./eval-write.js";
import { Marrow } from "./marrow.js";
import { Store } from "./store.js";

// The one scorecard: every measured number in a single report, produced from
// a single command against a scratch schema, so the published claims and the
// code can never quietly drift apart. Each arm resets the distilled layer
// before it runs (evidence stays append only, even in a scratch brain).

const here = dirname(fileURLToPath(import.meta.url));

interface CorpusSpec {
  file: string;
  source: string;
  entity: string;
  decisionTitle: string;
  decisionRationale: string;
  question: string;
}

/** The labeled benchmark corpus, shipped with the package. */
export function loadBenchmarkGolden(): { docs: SeedDoc[]; labeled: LabeledQuestion[] } {
  const fixturesDir = join(here, "..", "fixtures", "benchmark");
  const specs = JSON.parse(readFileSync(join(fixturesDir, "corpus.json"), "utf8")) as CorpusSpec[];
  const docs: SeedDoc[] = [];
  const labeled: LabeledQuestion[] = [];
  for (const spec of specs) {
    docs.push({
      source: spec.source,
      text: readFileSync(join(fixturesDir, spec.file), "utf8"),
      entity: spec.entity,
      decisionTitle: spec.decisionTitle,
      decisionRationale: spec.decisionRationale,
    });
    labeled.push({ question: spec.question, relevantTitles: [spec.entity, spec.decisionTitle] });
  }
  return { docs, labeled };
}

export interface Scorecard {
  benchmark: BenchmarkReport;
  evals: {
    catch: { precision: number; recall: number; f1: number; cases: number };
    write: {
      writePrecision: number;
      writeRecall: number;
      falseMemoryRate: number;
      duplicateRate: number;
      entityDuplicateRate: number;
      ingestionReadyP95Ms: number;
      cases: number;
    };
    temporal: { currentStateAccuracy: number; historicalAccuracy: number; cases: number };
  };
}

/**
 * Run every bundled eval plus the retrieval benchmark against the brain at
 * `scratchUrl` and return the combined scorecard. The caller is responsible
 * for pointing this at a DISPOSABLE brain (withScratchSchema): the arms seed
 * nodes and truncate the distilled layer between runs.
 */
export async function runScorecard(scratchUrl: string): Promise<Scorecard> {
  const store = new Store(scratchUrl);
  const admin = new pg.Pool({ connectionString: scratchUrl });
  const reset = async (): Promise<void> => {
    await admin.query(
      "truncate catch_events, verification, provenance, embedding, edge, entity, decision, question, goal restart identity cascade",
    );
  };
  try {
    // drift-catch eval: rule-based, keyless.
    await reset();
    const catchCore = new Marrow(store);
    const catchReport = await runEval(catchCore, loadSyntheticGolden(), reset);

    // write-quality eval: recorded model outputs through the real write path.
    await reset();
    const replay = createReplayModel();
    const writeCore = new Marrow(store, replay.provider, createConceptEmbedding());
    const writeReport = await runWriteEval(writeCore, replay, loadWriteGolden(), reset);

    // temporal accuracy: conflicts resolved through the answer loop.
    await reset();
    const temporalCore = new Marrow(store, undefined, createConceptEmbedding());
    const temporalReport = await runTemporalEval(temporalCore, loadTemporalGolden(), reset);

    // retrieval benchmark: the labeled corpus, decided through the loop.
    await reset();
    const benchCore = new Marrow(store, undefined, createConceptEmbedding());
    const { docs, labeled } = loadBenchmarkGolden();
    await seedBenchmarkBrain(benchCore, docs, { decide: true });
    const benchmark = await runBenchmark(benchCore, {
      corpusTexts: docs.map((d) => d.text),
      labeled,
      k: 4,
      measureBrief: true,
    });

    return {
      benchmark,
      evals: {
        catch: {
          precision: catchReport.precision,
          recall: catchReport.recall,
          f1: catchReport.f1,
          cases: catchReport.cases.length,
        },
        write: {
          writePrecision: writeReport.writePrecision,
          writeRecall: writeReport.writeRecall,
          falseMemoryRate: writeReport.falseMemoryRate,
          duplicateRate: writeReport.duplicateRate,
          entityDuplicateRate: writeReport.entityDuplicateRate,
          ingestionReadyP95Ms: writeReport.ingestionReadyP95Ms,
          cases: writeReport.cases.length,
        },
        temporal: {
          currentStateAccuracy: temporalReport.currentStateAccuracy,
          historicalAccuracy: temporalReport.historicalAccuracy,
          cases: temporalReport.cases.length,
        },
      },
    };
  } finally {
    await store.close();
    await admin.end();
  }
}
