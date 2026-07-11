import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type Marrow } from "./marrow.js";

// The temporal-accuracy eval: after a human resolves a conflict, retrieval
// must serve the winner (current-state accuracy) while the loser stays fully
// reachable with its content intact (historical accuracy). This is the
// invalidation-not-erasure story made into a number: Zep's headline strength,
// measured on Marrow's own loop. Every promotion and supersede in here goes
// through core.answer, the one sanctioned human path; the eval never touches
// a status directly.

const here = dirname(fileURLToPath(import.meta.url));

export interface TemporalEvalCase {
  name: string;
  /** The task an agent would ask about this topic (paraphrase; needs an
   *  embedding to match). */
  topic: string;
  /** A query sharing words with the titles, for the keyless keyword arm. */
  keywordTopic: string;
  loser: { title: string; rationale: string };
  winner: { title: string; rationale: string };
  /** The human's conflict-resolving answer text. */
  answer: string;
}

export interface TemporalEvalCaseResult {
  name: string;
  currentOk: boolean;
  historicalOk: boolean;
  detail: string;
}

export interface TemporalEvalReport {
  currentStateAccuracy: number;
  historicalAccuracy: number;
  cases: TemporalEvalCaseResult[];
}

/** The bundled temporal golden set, shipped with the package. */
export function loadTemporalGolden(): TemporalEvalCase[] {
  return JSON.parse(
    readFileSync(join(here, "..", "fixtures", "temporal-golden.json"), "utf8"),
  ) as TemporalEvalCase[];
}

export async function runTemporalEval(
  core: Marrow,
  cases: TemporalEvalCase[],
  reset: () => Promise<void> = () => Promise.resolve(),
): Promise<TemporalEvalReport> {
  if (cases.length === 0) {
    throw new Error(
      "temporal eval: refusing to score zero cases; an empty run is not a perfect run.",
    );
  }

  const results: TemporalEvalCaseResult[] = [];
  for (const c of cases) {
    await reset();

    // seed the room: both claims exist as proposed (open) decisions.
    const evidenceId = await core.ingest({
      text: `${c.loser.title}. ${c.loser.rationale}. Later: ${c.winner.title}. ${c.winner.rationale}.`,
      source: `temporal-eval/${c.name}`,
    });
    const span = { evidenceId, start: 0, end: Math.min(60, c.loser.title.length + 2) };
    const loser = await core.proposeNode({
      kind: "decision",
      title: c.loser.title,
      rationale: c.loser.rationale,
      provenance: [span],
      confidence: 0.6,
    });
    const winner = await core.proposeNode({
      kind: "decision",
      title: c.winner.title,
      rationale: c.winner.rationale,
      provenance: [span],
      confidence: 0.6,
    });
    // the loser was the earlier truth: promote it through the answer loop.
    const confirm = await core.proposeNode({
      kind: "question",
      prompt: `confirm: ${c.loser.title}`,
      relatesTo: [loser.id],
      provenance: [span],
      confidence: 0.6,
    });
    await core.answer(confirm.id, "confirmed at the time");
    // then the conflict is resolved for the winner; answer supersedes the loser.
    const conflict = await core.proposeNode({
      kind: "question",
      prompt: `conflict: "${c.winner.title}" vs "${c.loser.title}". which holds?`,
      relatesTo: [winner.id, loser.id],
      provenance: [span],
      confidence: 0.6,
    });
    await core.answer(conflict.id, c.answer, { decide: winner.id });

    // current state: the brief serves the winner and never the loser, and
    // flat search ranks the winner above the loser.
    const brief = await core.prepareTask(c.topic);
    const factIds = brief.safeToBuild.facts.map((f) => f.id);
    const briefOk = factIds.includes(winner.id) && !factIds.includes(loser.id);
    const ids = (await core.search(c.topic, 8)).map((n) => n.id);
    const winnerAt = ids.indexOf(winner.id);
    const loserAt = ids.indexOf(loser.id);
    const searchOk = winnerAt >= 0 && (loserAt === -1 || winnerAt < loserAt);
    const currentOk = briefOk && searchOk;

    // history: the loser keeps status superseded, its content, and its spans.
    const stored = await core.getNode(loser.id);
    const trace = await core.traceToSource(loser.id);
    const historicalOk =
      stored?.status === "superseded" &&
      stored.kind === "decision" &&
      stored.title === c.loser.title &&
      trace.spans.length > 0;

    results.push({
      name: c.name,
      currentOk,
      historicalOk,
      detail:
        currentOk && historicalOk
          ? "ok"
          : `brief=${briefOk} search=${searchOk} history=${historicalOk}`,
    });
  }
  await reset();

  const n = results.length;
  return {
    currentStateAccuracy: results.filter((r) => r.currentOk).length / n,
    historicalAccuracy: results.filter((r) => r.historicalOk).length / n,
    cases: results,
  };
}
