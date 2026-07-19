import { normalizeTitle } from "./link.js";
import { type Marrow } from "./marrow.js";

// PR-13: make the token-reduction claim reproducible. Measured, never projected.
// The estimate is a stable ~4-chars-per-token heuristic so the ratio does not
// drift with a tokenizer library version. benchmark/report.json carries the run.

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Serialize a node (or slice) as the agent would consume it, for the token
 *  measurement: the human-accountability decider is stripped, matching what
 *  prepare_task's brief serves. Keeps the benchmark measuring agent cost and
 *  keeps it deterministic (no OS-user leak from the promote path). */
function measureJson(value: unknown): string {
  return JSON.stringify(value, (key, val) => (key === "decidedBy" ? undefined : val));
}

export interface SeedDoc {
  source: string;
  text: string;
  entity: string;
  decisionTitle: string;
  decisionRationale: string;
}

/** Populate the brain from the corpus: each doc becomes evidence plus a couple
 *  of proposed (open) distilled nodes citing a span. With decide: true, each
 *  decision is then promoted through the sanctioned human path (a confirm
 *  question answered), so the brief arm measures a brain that actually has
 *  decided truth in it; nothing here writes decided directly. */
export async function seedBenchmarkBrain(
  core: Marrow,
  docs: SeedDoc[],
  opts: { decide?: boolean } = {},
): Promise<void> {
  for (const doc of docs) {
    const evidenceId = await core.ingest({ text: doc.text, source: doc.source });
    const span = { evidenceId, start: 0, end: Math.min(60, doc.text.length) };
    await core.proposeNode({
      kind: "entity",
      name: doc.entity,
      provenance: [span],
      confidence: 0.6,
    });
    const decision = await core.proposeNode({
      kind: "decision",
      title: doc.decisionTitle,
      rationale: doc.decisionRationale,
      provenance: [span],
      confidence: 0.6,
    });
    if (opts.decide) {
      const confirm = await core.proposeNode({
        kind: "question",
        prompt: `confirm: ${doc.decisionTitle}`,
        relatesTo: [decision.id],
        provenance: [span],
        confidence: 0.6,
      });
      await core.answer(confirm.id, "confirmed for the benchmark corpus");
    }
  }
}

/** One benchmark question with the node titles a correct slice must contain. */
export interface LabeledQuestion {
  question: string;
  relevantTitles: string[];
}

export interface QuestionResult {
  question: string;
  tokens: number;
  latencyMs: number;
  results: number;
  /** Fraction of this question's labeled relevant nodes present in the slice. */
  recall?: number;
  /** Tokens of slice entries that match no labeled relevant node. */
  noiseTokens?: number;
}

export interface BriefQuestionResult {
  question: string;
  tokens: number;
  latencyMs: number;
}

export interface BenchmarkReport {
  tokenizer: string;
  baseline: { docs: number; tokens: number };
  marrow: { questions: QuestionResult[]; avgTokens: number; avgLatencyMs: number };
  ratio: number;
  /** Present when labeled questions were provided: is the slice RIGHT, not
   *  just small. recallAtK is the mean per-question recall; noiseRatio is
   *  off-topic slice tokens over total slice tokens. */
  quality?: { recallAtK: number; noiseRatio: number };
  /** The prepare_task arm: what an agent actually loads per task. Reported
   *  separately from the flat-search ratio, never blended into it. */
  brief?: {
    questions: BriefQuestionResult[];
    avgTokens: number;
    avgLatencyMs: number;
    ratio: number;
  };
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
  input: {
    corpusTexts: string[];
    questions?: string[];
    labeled?: LabeledQuestion[];
    k?: number;
    /** Also measure the prepare_task brief per question (tokens + latency). */
    measureBrief?: boolean;
  },
): Promise<BenchmarkReport> {
  const baselineTokens = estimateTokens(input.corpusTexts.join("\n\n"));
  const k = input.k ?? 8;
  const asked: LabeledQuestion[] =
    input.labeled ?? (input.questions ?? []).map((question) => ({ question, relevantTitles: [] }));

  const questions: QuestionResult[] = [];
  let relevantHits = 0;
  let relevantTotal = 0;
  let noiseTokensTotal = 0;
  let sliceTokensTotal = 0;
  for (const { question, relevantTitles } of asked) {
    const start = performance.now();
    const slice = await core.search(question, k);
    const latencyMs = round(performance.now() - start);
    const result: QuestionResult = {
      question,
      // measure the agent's token cost: the decider is human-accountability
      // metadata the agent never reads (the brief strips it too), and it would
      // otherwise stamp the env's OS user into the count and make the report
      // drift by machine.
      tokens: estimateTokens(measureJson(slice)),
      latencyMs,
      results: slice.length,
    };
    if (relevantTitles.length > 0) {
      const wanted = relevantTitles.map(normalizeTitle);
      const titleOf = (node: (typeof slice)[number]): string =>
        normalizeTitle(
          node.kind === "entity" ? node.name : node.kind === "question" ? node.prompt : node.title,
        );
      const present = new Set(slice.map(titleOf));
      const hits = wanted.filter((title) => present.has(title)).length;
      result.recall = round(hits / wanted.length);
      result.noiseTokens = slice
        .filter((node) => !wanted.includes(titleOf(node)))
        .reduce((sum, node) => sum + estimateTokens(measureJson(node)), 0);
      relevantHits += hits;
      relevantTotal += wanted.length;
      noiseTokensTotal += result.noiseTokens;
      sliceTokensTotal += result.tokens;
    }
    questions.push(result);
  }

  const n = Math.max(questions.length, 1);
  const avgTokens = Math.round(questions.reduce((s, q) => s + q.tokens, 0) / n);
  const avgLatencyMs = round(questions.reduce((s, q) => s + q.latencyMs, 0) / n);

  const report: BenchmarkReport = {
    tokenizer: "chars/4 heuristic",
    baseline: { docs: input.corpusTexts.length, tokens: baselineTokens },
    marrow: { questions, avgTokens, avgLatencyMs },
    ratio: round(baselineTokens / Math.max(avgTokens, 1), 1),
  };
  if (relevantTotal > 0) {
    report.quality = {
      recallAtK: round(relevantHits / relevantTotal),
      noiseRatio: round(noiseTokensTotal / Math.max(sliceTokensTotal, 1)),
    };
  }

  if (input.measureBrief) {
    const briefQuestions: BriefQuestionResult[] = [];
    for (const { question } of asked) {
      const start = performance.now();
      const brief = await core.prepareTask(question);
      const latencyMs = round(performance.now() - start);
      briefQuestions.push({
        question,
        tokens: estimateTokens(JSON.stringify(brief)),
        latencyMs,
      });
    }
    const bn = Math.max(briefQuestions.length, 1);
    const briefAvgTokens = Math.round(briefQuestions.reduce((s, q) => s + q.tokens, 0) / bn);
    report.brief = {
      questions: briefQuestions,
      avgTokens: briefAvgTokens,
      avgLatencyMs: round(briefQuestions.reduce((s, q) => s + q.latencyMs, 0) / bn),
      ratio: round(baselineTokens / Math.max(briefAvgTokens, 1), 1),
    };
  }

  return report;
}
