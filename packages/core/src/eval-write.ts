import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeTitle } from "./link.js";
import { type Marrow } from "./marrow.js";

// The write-quality eval: the direct answer to the research's central lesson
// that memory writing is harder than retrieval (the public Mem0 audit found
// 97.8 percent of one deployment's auto-captured memories were junk). It
// drives the REAL write path (ingest, distill, span resolution, linkAndMerge)
// with model outputs recorded once from a well-behaved run, so CI measures the
// deterministic pipeline guards, not live model quality. The replay arm is
// keyless and deterministic; what it cannot see (a live model misbehaving) is
// the extraction policy's job (roadmap R23) and must not be faked here.

const here = dirname(fileURLToPath(import.meta.url));

export interface WriteEvalCase {
  name: string;
  /** Which failure class this case guards, for the methodology doc. */
  trap: string;
  evidence: { text: string; source: string };
  /** The JSON a model returned for this evidence, recorded once. */
  recordedExtraction: unknown;
  /** Titles (by kind) that must exist after the write, normalized-title match.
   *  An explicitly empty list asserts the kind stays empty. */
  expected: {
    entities?: string[];
    decisions?: string[];
    goals?: string[];
    questions?: string[];
  };
}

export interface WriteEvalCaseResult {
  name: string;
  created: { kind: string; title: string }[];
  matched: number;
  missed: string[];
  extra: string[];
  falseMemories: number;
  duplicateNodes: number;
  ingestionReadyMs: number;
}

export interface WriteEvalReport {
  writePrecision: number;
  writeRecall: number;
  falseMemoryRate: number;
  duplicateRate: number;
  entityDuplicateRate: number;
  ingestionReadyP95Ms: number;
  cases: WriteEvalCaseResult[];
}

/** The bundled write-quality golden set, shipped with the package. Resolves
 *  relative to this module (one level under the package root in src and dist). */
export function loadWriteGolden(): WriteEvalCase[] {
  return JSON.parse(
    readFileSync(join(here, "..", "fixtures", "write-golden.json"), "utf8"),
  ) as WriteEvalCase[];
}

/** A model provider whose next response is set per case. */
export interface ReplayModel {
  provider: { model: string; complete: () => Promise<string> };
  set(extraction: unknown): void;
}

export function createReplayModel(): ReplayModel {
  let response = "{}";
  return {
    provider: { model: "marrow-replay", complete: () => Promise.resolve(response) },
    set(extraction: unknown) {
      response = JSON.stringify(extraction);
    },
  };
}

const nodeTitle = (node: { kind: string } & Record<string, unknown>): string =>
  String(node.kind === "entity" ? node.name : node.kind === "question" ? node.prompt : node.title);

/**
 * Run the write-quality eval. The caller supplies a core wired with the replay
 * model (createReplayModel) plus any deterministic embedding, and a reset
 * callback that clears the distilled layer between cases (evidence is append
 * only, even here). Metrics:
 *
 * - writePrecision / writeRecall: expected titles vs created nodes, matched by
 *   normalized title. Questions count toward recall only: the system raising
 *   an extra question for a human is a feature, never junk memory.
 * - falseMemoryRate: created nodes whose provenance span is not a verbatim
 *   substring of the evidence. Gate at exactly 0: the drop-guard's proof.
 * - duplicateRate: each case's evidence is ingested twice; surviving nodes
 *   that share a normalized title are duplicates. Entities merge at write
 *   time today, so entityDuplicateRate gates at 0; decisions and goals gain
 *   their write-time guard in roadmap R17, so the overall rate is reported,
 *   not gated, until then.
 * - ingestionReadyP95Ms: how long until a written fact is retrievable. Honest
 *   because Marrow distills synchronously: when the call returns, reads see it.
 */
export async function runWriteEval(
  core: Marrow,
  replay: ReplayModel,
  cases: WriteEvalCase[],
  reset: () => Promise<void> = () => Promise.resolve(),
): Promise<WriteEvalReport> {
  if (cases.length === 0) {
    throw new Error("write eval: refusing to score zero cases; an empty run is not a perfect run.");
  }

  const results: WriteEvalCaseResult[] = [];
  const latencies: number[] = [];
  let scoredCreated = 0;
  let matchedTotal = 0;
  let expectedTotal = 0;
  let falseMemoryTotal = 0;
  let createdTotal = 0;
  let duplicateTotal = 0;
  let doubledTotal = 0;
  let entityDuplicateTotal = 0;
  let doubledEntities = 0;

  for (const c of cases) {
    await reset();
    replay.set(c.recordedExtraction);

    const startedAt = performance.now();
    const { evidenceId, nodes } = await core.ingestAndDistill(c.evidence);
    const ingestionReadyMs = performance.now() - startedAt;
    latencies.push(ingestionReadyMs);

    // score against expectations, normalized-title match per kind.
    const KIND_KEY: Record<string, string> = {
      entities: "entity",
      decisions: "decision",
      goals: "goal",
      questions: "question",
    };
    const expectedByKind = new Map<string, string[]>(
      Object.entries(c.expected).map(([kind, titles]) => [
        KIND_KEY[kind] ?? kind,
        (titles ?? []).map(normalizeTitle),
      ]),
    );
    const missed: string[] = [];
    const extra: string[] = [];
    let matched = 0;
    for (const [kind, titles] of expectedByKind) {
      const created = nodes
        .filter((n) => n.kind === kind)
        .map((n) => normalizeTitle(nodeTitle(n as never)));
      for (const title of titles) {
        if (created.includes(title)) matched += 1;
        else missed.push(`${kind}: ${title}`);
      }
      // questions count toward recall only: raising one is asking a human.
      if (kind === "question") continue;
      for (const title of created) {
        if (!titles.includes(title)) extra.push(`${kind}: ${title}`);
      }
      scoredCreated += created.length;
      expectedTotal += titles.length;
    }
    matchedTotal += matched;

    // false memories: every stored span must be a verbatim substring.
    let falseMemories = 0;
    for (const node of nodes) {
      const trace = await core.traceToSource(node.id);
      for (const span of trace.spans) {
        if (span.evidenceId !== evidenceId) continue;
        if (!c.evidence.text.includes(span.spanText)) falseMemories += 1;
      }
    }
    falseMemoryTotal += falseMemories;
    createdTotal += nodes.length;

    // duplicates: the same room restated (re-ingested) must not double the
    // brain. Entities merge today; decisions and goals are R17's job.
    replay.set(c.recordedExtraction);
    await core.ingestAndDistill({
      text: c.evidence.text,
      source: `${c.evidence.source}#restated`,
    });
    const after = [
      ...(await core.getDecisions()),
      ...(await core.getGoals()),
      ...(await core.listEntities()),
    ];
    const byTitle = new Map<string, number>();
    for (const node of after) {
      const key = `${node.kind}:${normalizeTitle(nodeTitle(node as never))}`;
      byTitle.set(key, (byTitle.get(key) ?? 0) + 1);
    }
    let duplicateNodes = 0;
    let entityDuplicates = 0;
    for (const [key, count] of byTitle) {
      if (count <= 1) continue;
      duplicateNodes += count - 1;
      if (key.startsWith("entity:")) entityDuplicates += count - 1;
    }
    duplicateTotal += duplicateNodes;
    doubledTotal += after.length;
    entityDuplicateTotal += entityDuplicates;
    doubledEntities += after.filter((n) => n.kind === "entity").length;

    results.push({
      name: c.name,
      created: nodes.map((n) => ({ kind: n.kind, title: nodeTitle(n as never) })),
      matched,
      missed,
      extra,
      falseMemories,
      duplicateNodes,
      ingestionReadyMs: Math.round(ingestionReadyMs * 100) / 100,
    });
  }
  await reset();

  const extraTotal = results.reduce((sum, r) => sum + r.extra.length, 0);
  const sorted = [...latencies].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
  return {
    writePrecision: scoredCreated > 0 ? matchedTotal / (matchedTotal + extraTotal) : 0,
    writeRecall: expectedTotal > 0 ? matchedTotal / expectedTotal : 0,
    falseMemoryRate: createdTotal > 0 ? falseMemoryTotal / createdTotal : 0,
    duplicateRate: doubledTotal > 0 ? duplicateTotal / doubledTotal : 0,
    entityDuplicateRate: doubledEntities > 0 ? entityDuplicateTotal / doubledEntities : 0,
    ingestionReadyP95Ms: Math.round(p95 * 100) / 100,
    cases: results,
  };
}
