import { type Marrow } from "./marrow.js";

// PR-13: make the token-reduction claim reproducible. Measured, never projected.
// The estimate is a stable ~4-chars-per-token heuristic so the ratio does not
// drift with a tokenizer library version. benchmark/report.json carries the run.

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface SeedDoc {
  source: string;
  text: string;
  entity: string;
  decisionTitle: string;
  decisionRationale: string;
}

/** Populate the brain from the corpus: each doc becomes evidence plus a couple
 *  of proposed (open) distilled nodes citing a span. Open, never decided. */
export async function seedBenchmarkBrain(core: Marrow, docs: SeedDoc[]): Promise<void> {
  for (const doc of docs) {
    const evidenceId = await core.ingest({ text: doc.text, source: doc.source });
    const span = { evidenceId, start: 0, end: Math.min(60, doc.text.length) };
    await core.proposeNode({
      kind: "entity",
      name: doc.entity,
      provenance: [span],
      confidence: 0.6,
    });
    await core.proposeNode({
      kind: "decision",
      title: doc.decisionTitle,
      rationale: doc.decisionRationale,
      provenance: [span],
      confidence: 0.6,
    });
  }
}

export interface QuestionResult {
  question: string;
  tokens: number;
  latencyMs: number;
  results: number;
}

export interface BenchmarkReport {
  tokenizer: string;
  baseline: { docs: number; tokens: number };
  marrow: { questions: QuestionResult[]; avgTokens: number; avgLatencyMs: number };
  ratio: number;
}

const round = (n: number, places = 2): number => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

/**
 * Measure both arms on a populated brain. Baseline = the tokens to dump every
 * raw corpus doc into context. Marrow = the tokens of the task-scoped slice
 * returned for each question, plus its retrieval latency.
 */
export async function runBenchmark(
  core: Marrow,
  input: { corpusTexts: string[]; questions: string[]; k?: number },
): Promise<BenchmarkReport> {
  const baselineTokens = estimateTokens(input.corpusTexts.join("\n\n"));
  const k = input.k ?? 8;

  const questions: QuestionResult[] = [];
  for (const question of input.questions) {
    const start = performance.now();
    const slice = await core.search(question, k);
    const latencyMs = round(performance.now() - start);
    questions.push({
      question,
      tokens: estimateTokens(JSON.stringify(slice)),
      latencyMs,
      results: slice.length,
    });
  }

  const n = Math.max(questions.length, 1);
  const avgTokens = Math.round(questions.reduce((s, q) => s + q.tokens, 0) / n);
  const avgLatencyMs = round(questions.reduce((s, q) => s + q.latencyMs, 0) / n);

  return {
    tokenizer: "chars/4 heuristic",
    baseline: { docs: input.corpusTexts.length, tokens: baselineTokens },
    marrow: { questions, avgTokens, avgLatencyMs },
    ratio: round(baselineTokens / Math.max(avgTokens, 1), 1),
  };
}
