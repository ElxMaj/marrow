import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type Decision } from "@marrowhq/shared";

import { type DiffHunk } from "./drift.js";
import { type Marrow } from "./marrow.js";

const here = dirname(fileURLToPath(import.meta.url));

// PR-17: golden-set eval harness for the catch. Measures precision/recall on
// labeled local fixtures; current bundled cases are synthetic.

export interface EvalDecisionSeed {
  title: string;
  rationale?: string;
  constraint?: boolean;
}

export interface EvalCase {
  name: string;
  decisions: EvalDecisionSeed[];
  hunks: DiffHunk[];
  /** Which (hunk, decision) pairs SHOULD be caught. */
  expected: { hunkIndex: number; decisionIndex: number }[];
  synthetic: boolean;
}

export interface EvalCaseResult {
  name: string;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  surfaced: { hunkIndex: number; decisionId: string }[];
  synthetic: boolean;
}

export interface EvalReport {
  precision: number;
  recall: number;
  f1: number;
  cases: EvalCaseResult[];
}

/** Seed the decided facts for one eval case and return the decision ids in the
 *  same order as the case's decisions array. */
export async function seedEvalCase(core: Marrow, c: EvalCase): Promise<string[]> {
  const ids: string[] = [];
  for (const d of c.decisions) {
    const text = `${d.title}. ${d.rationale ?? ""}`;
    const evidenceId = await core.ingest({ text, source: `eval:${c.name}` });
    const decision = (await core.proposeNode({
      kind: "decision",
      title: d.title,
      rationale: d.rationale ?? "",
      constraint: d.constraint ?? false,
      provenance: [{ evidenceId, start: 0, end: Math.min(60, text.length) }],
      confidence: 0.6,
    })) as Decision;
    const answerEvId = await core.ingest({
      text: "confirmed in eval",
      source: `eval:${c.name}:answer`,
    });
    const confirmQuestion = await core.proposeNode({
      kind: "question",
      prompt: `confirm: ${d.title}`,
      relatesTo: [decision.id],
      provenance: [{ evidenceId: answerEvId, start: 0, end: 17 }],
      confidence: 0.6,
    });
    await core.answer(confirmQuestion.id, "confirmed in eval");
    ids.push(decision.id);
  }
  return ids;
}

/** The bundled synthetic golden set, shipped with the package so `marrow eval`
 *  scores real cases out of the box. Resolves relative to this module, which
 *  sits one level under the package root in both src (dev) and dist (published). */
export function loadSyntheticGolden(): EvalCase[] {
  return JSON.parse(
    readFileSync(join(here, "..", "fixtures", "synthetic-golden.json"), "utf8"),
  ) as EvalCase[];
}

export async function runEval(
  core: Marrow,
  cases: EvalCase[],
  reset: () => Promise<void> = () => Promise.resolve(),
): Promise<EvalReport> {
  if (cases.length === 0) {
    throw new Error(
      "eval: refusing to score zero cases; an empty run is not a perfect run. Pass a fixture file or run with no arguments to use the bundled golden set.",
    );
  }
  const results: EvalCaseResult[] = [];

  for (const c of cases) {
    await reset();
    const decisionIds = await seedEvalCase(core, c);
    const { created } = await core.driftScan(".", {
      hunks: c.hunks,
      semantic: false,
      trigger: "eval",
      synthetic: c.synthetic,
    });

    const surfaced = created
      .filter((q): q is import("@marrowhq/shared").Question => q.kind === "question")
      .flatMap((q) => {
        const decisionId = (q.relatesTo ?? []).find((id: string) => decisionIds.includes(id));
        if (!decisionId) return [];
        // the drift prompt embeds the verbatim "path:start-end" span; match that
        // directly. normalizing the prompt first strips the punctuation in the
        // span, so the hunk could never be found.
        const hunkIndex = c.hunks.findIndex((h) =>
          q.prompt.includes(`${h.path}:${h.lineStart}-${h.lineEnd}`),
        );
        if (hunkIndex < 0) return [];
        return [{ hunkIndex, decisionId }];
      });

    const expectedSet = new Set(
      c.expected.map((e) => `${e.hunkIndex}:${decisionIds[e.decisionIndex]}`),
    );
    const surfacedSet = new Set(surfaced.map((s) => `${s.hunkIndex}:${s.decisionId}`));

    let truePositives = 0;
    for (const key of surfacedSet) {
      if (expectedSet.has(key)) truePositives += 1;
    }
    const falsePositives = surfacedSet.size - truePositives;
    const falseNegatives = expectedSet.size - truePositives;
    const precision = surfacedSet.size > 0 ? truePositives / surfacedSet.size : 1;
    const recall = expectedSet.size > 0 ? truePositives / expectedSet.size : 1;

    results.push({
      name: c.name,
      truePositives,
      falsePositives,
      falseNegatives,
      precision,
      recall,
      surfaced,
      synthetic: c.synthetic,
    });
  }

  const totalTP = results.reduce((s, r) => s + r.truePositives, 0);
  const totalFP = results.reduce((s, r) => s + r.falsePositives, 0);
  const totalFN = results.reduce((s, r) => s + r.falseNegatives, 0);
  const precision = totalTP + totalFP > 0 ? totalTP / (totalTP + totalFP) : 1;
  const recall = totalTP + totalFN > 0 ? totalTP / (totalTP + totalFN) : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { precision, recall, f1, cases: results };
}

/** Smoke test: every synthetic case must have zero false positives. */
export function assertNoSyntheticFalsePositives(report: EvalReport): void {
  const offenders = report.cases.filter((c) => c.synthetic && c.falsePositives > 0);
  if (offenders.length > 0) {
    const names = offenders.map((c) => c.name).join(", ");
    throw new Error(`eval smoke test failed: synthetic cases had false positives: ${names}`);
  }
}
