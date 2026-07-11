import {
  type ConnectorConfigRecord,
  type ConnectorSummary,
  type ConnectorSyncResult,
  type Decision,
  type EdgeNodeKind,
  type Entity,
  type Evidence,
  type Goal,
  type Provenance,
  type Question,
  type Relation,
  type RunMetrics,
  type RunRecord,
  type Status,
} from "@marrowhq/shared";

import { encryptSecret } from "./crypto.js";
import {
  type Distilled,
  buildDistillPrompt,
  chunkText,
  distilledKey,
  DISTILL_SYSTEM,
  nodeKey,
  parseExtraction,
  resolveSpan,
} from "./distill.js";
import { type DiffHunk, readGitDiff } from "./drift.js";
import {
  decisionsConcerningEntity,
  decisionsConflict,
  entityHasDecision,
  goalDriftSignal,
  goalsConflict,
  normalizeTitle,
  ruleDriftSignal,
} from "./link.js";
import { rankQuestions } from "./loop.js";
import { traced } from "./observability.js";
import { scanRepo } from "./onboard.js";
import { CONNECTOR_KINDS, type ConnectorKind, SyncEngine } from "./sync.js";
import {
  createEmbeddingProvider,
  createModelProvider,
  createTranscriptionProvider,
  createVisionProvider,
  loadProviderConfig,
} from "./providers/config.js";
import {
  type EmbeddingProvider,
  type ModelProvider,
  type TranscriptionProvider,
  type VisionProvider,
} from "./providers/types.js";
import { semanticDriftCheck } from "./semantic-drift.js";
import { skepticReasons, type VerifyReason, verdictFor } from "./skeptic.js";
import { type IndexEntry, type RunFilter, Store, createStore } from "./store.js";

export interface IngestInput {
  text: string;
  source: string;
  /** The item's source-side time (message ts, issue updated_at, etc.). When a
   *  connector reports it, the sync cursor advances to the newest item's time
   *  (a true high-water mark) instead of the local wall clock, which closes the
   *  data-loss window that clock skew between Marrow and the provider opens. */
  timestamp?: Date;
}

// A generous output budget so a real meeting's extraction is not truncated at
// the provider default (Claude caps at 1024), and an input chunk size so a long
// transcript is distilled in pieces rather than overrunning that budget.
const DISTILL_MAX_TOKENS = 4096;
const DISTILL_CHUNK_CHARS = 8000;

const SEMANTIC_CONFIDENCE_THRESHOLD = 0.7;

// Goal drift is rule-only and aspirational, so it surfaces at a lower bar than
// decision drift. The negated goal signal (0.45) clears it; the weak affirmed
// signal (0.25) does not, keeping goal catches conservative.
const GOAL_DRIFT_THRESHOLD = 0.4;

const BRIEF_LIMIT = 6;
const TRUTH_LIMIT = 8;

function nodeTitle(node: Distilled): string {
  if (node.kind === "entity") return node.name;
  if (node.kind === "decision") return node.title;
  if (node.kind === "goal") return node.title;
  return node.prompt;
}

function nodeSearchText(node: Distilled): string {
  if (node.kind === "entity") return `${node.name} ${node.description ?? ""}`;
  if (node.kind === "decision") return `${node.title} ${node.rationale}`;
  if (node.kind === "goal") return `${node.title} ${node.description ?? ""}`;
  return node.prompt;
}

function terms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((term) => term.replace(/s$/, ""))
      .filter((term) => term.length >= 3),
  );
}

function relevance(task: string, node: Distilled): number {
  const taskTerms = terms(task);
  if (taskTerms.size === 0) return 0;
  const textTerms = terms(nodeSearchText(node));
  let score = 0;
  for (const term of taskTerms) if (textTerms.has(term)) score += 1;
  return score;
}

// The boost map scores retrieval seeds and their graph neighbors above plain
// term overlap: a search hit is +10, a 1-hop neighbor +4, a 2-hop neighbor +2.
// A node present in the map is kept even with zero shared words, which is how a
// fact one or two hops from the task can surface at all.
function byRelevance(task: string, boost: Map<string, number>) {
  return (a: Distilled, b: Distilled): number => {
    const scoreA = relevance(task, a) + (boost.get(a.id) ?? 0);
    const scoreB = relevance(task, b) + (boost.get(b.id) ?? 0);
    if (scoreA !== scoreB) return scoreB - scoreA;
    return b.updatedAt.localeCompare(a.updatedAt);
  };
}

function uniqueNodes(nodes: Distilled[]): Distilled[] {
  const seen = new Set<string>();
  const out: Distilled[] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    out.push(node);
  }
  return out;
}

function uniqueBriefNodes(nodes: BriefNode[]): BriefNode[] {
  const seen = new Set<string>();
  const out: BriefNode[] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    out.push(node);
  }
  return out;
}

function relevantOnly(task: string, boost: Map<string, number>, nodes: Distilled[]): Distilled[] {
  return uniqueNodes(nodes)
    .filter((node) => boost.has(node.id) || relevance(task, node) > 0)
    .sort(byRelevance(task, boost));
}

function isGapQuestion(question: BriefNode): boolean {
  return /goal gap|gap|never decided|feature or product|which feature|served feature/i.test(
    question.title,
  );
}

/** What ingest needs to hand distillation to the background queue. The Queue in
 *  queue.ts satisfies this; keeping it an interface keeps Marrow off pg-boss. */
export interface DistillEnqueuer {
  enqueueDistill(evidenceId: string): Promise<string>;
}

export interface TraceSpan {
  evidenceId: string;
  source: string;
  /** when the evidence this span points at was captured: the source date. */
  createdAt: string;
  start: number;
  end: number;
  spanText: string;
}

export interface TraceResult {
  nodeId: string;
  source: string | undefined;
  spanText: string | undefined;
  spans: TraceSpan[];
}

export interface BriefNode {
  id: string;
  kind: Distilled["kind"];
  title: string;
  status: Status;
  confidence: Distilled["confidence"];
  provenance: TraceSpan[];
  /** when a human promoted this fact, if ever. */
  verifiedAt?: string;
  /** true when a decided fact is past its expiry or older than the staleness
   *  window: safe to build, but worth reverifying. */
  stale?: boolean;
  goalType?: "product" | "user";
  entityId?: string;
  relatesTo?: string[];
  constraint?: boolean;
}

/**
 * Whether a decided fact should be reverified: past its expiry, or (with no
 * expiry) older than the staleness window by verification or last update. A
 * fact that is not decided is never stale. `now` is injectable for testing.
 */
export function isFactStale(
  node: {
    status: Status;
    verifiedAt?: string | undefined;
    expiresAt?: string | undefined;
    updatedAt: string;
  },
  staleDays: number = Number(process.env.MARROW_STALE_DAYS) || 365,
  now: number = Date.now(),
): boolean {
  if (node.expiresAt && new Date(node.expiresAt).getTime() < now) return true;
  if (node.status !== "decided") return false;
  const base = node.verifiedAt ?? node.updatedAt;
  return now - new Date(base).getTime() > staleDays * 24 * 60 * 60 * 1000;
}

/** One node linked to a seed node in the graph, with how it links and how far. */
export interface NeighborLink {
  id: string;
  kind: EdgeNodeKind;
  title: string;
  status: Status;
  depth: number;
  /** the relation and edge confidence, present for direct (1-hop) neighbors. */
  relation?: Relation;
  edgeConfidence?: number;
}

/** A node and the graph neighborhood around it. `node` is undefined when the id
 *  resolves to nothing. Bounded: never the whole brain. */
export interface NeighborsBrief {
  node: { id: string; kind: EdgeNodeKind; title: string; status: Status } | undefined;
  neighbors: NeighborLink[];
}

/** One proposed fact the skeptic looked at, with its verdict and any flags. */
export interface VerifyResult {
  nodeId: string;
  kind: Distilled["kind"];
  title: string;
  verdict: "survived" | "flagged";
  reasons: VerifyReason[];
}

/** The skeptic's pass over the currently-proposed facts. */
export interface VerifyReport {
  checked: number;
  survived: number;
  flagged: number;
  results: VerifyResult[];
}

/** One edge in the console graph, endpoints as bare node ids. */
export interface GraphEdge {
  from: string;
  to: string;
  relation: Relation;
}

/** The brain as a node-link graph for the console map. Bounded, titles only. */
export interface BrainGraph {
  nodes: IndexEntry[];
  edges: GraphEdge[];
}

export interface TaskBrief {
  task: string;
  status: "safe_to_build" | "ask_human_first";
  safeToBuild: { facts: BriefNode[] };
  askHumanFirst: { questions: BriefNode[]; contestedFacts: BriefNode[] };
  check?: {
    createdDriftQuestions: BriefNode[];
    catchEventIds: number[];
    receiptData: Awaited<ReturnType<Marrow["renderCatchReceipt"]>>[];
    nextCommands: { questionId: string; accept: string; dismiss: string }[];
  };
}

export interface TruthMaintenanceBrief {
  sourceOfTruth: { decidedGoals: BriefNode[]; decidedDecisions: BriefNode[] };
  openProposedGoals: BriefNode[];
  contestedFacts: BriefNode[];
  gapQuestions: BriefNode[];
  pendingCatches: Awaited<ReturnType<Marrow["renderCatchReceipt"]>>[];
  connectorHealth: {
    name: string;
    kind: string;
    enabled: boolean;
    status: "ok" | "error" | "never" | "disabled" | "stale";
    lastRunAt?: string;
    lastError?: string;
    totalItems: number;
    hasSecret: boolean;
  }[];
  nextActions: string[];
}

export type ProposeInput =
  | {
      kind: "entity";
      name: string;
      description?: string | undefined;
      provenance: Provenance;
      confidence?: number | undefined;
    }
  | {
      kind: "decision";
      title: string;
      rationale?: string | undefined;
      constraint?: boolean | undefined;
      provenance: Provenance;
      confidence?: number | undefined;
    }
  | {
      kind: "question";
      prompt: string;
      relatesTo?: string[] | undefined;
      provenance: Provenance;
      confidence?: number | undefined;
    }
  | {
      kind: "goal";
      title: string;
      description?: string | undefined;
      goalType: "product" | "user";
      entityId?: string | undefined;
      provenance: Provenance;
      confidence?: number | undefined;
    };

/**
 * The core facade. Every surface (MCP server, CLI, web) drives Marrow through
 * this one object, never the Store directly. Ingestion is always available;
 * distillation needs a model and an embedding provider, injected here so tests
 * use deterministic fakes and self-hosters bring their own.
 */
export class Marrow {
  constructor(
    private readonly store: Store,
    private readonly model?: ModelProvider,
    private readonly embedding?: EmbeddingProvider,
    private readonly enqueuer?: DistillEnqueuer,
    private readonly vision?: VisionProvider,
    private readonly transcription?: TranscriptionProvider,
  ) {}

  /**
   * Store the room verbatim as evidence and return the new evidence id fast. Raw
   * is never deduped and never mutated; offsets into the stored text stay
   * stable. If a queue is wired, distillation is enqueued as a background job
   * so ingestion never blocks on the model.
   */
  async ingest(input: IngestInput): Promise<string> {
    const evidence = await this.store.insertEvidence({ text: input.text, source: input.source });
    if (this.enqueuer) await this.enqueuer.enqueueDistill(evidence.id);
    return evidence.id;
  }

  async getEvidence(id: string): Promise<Evidence | undefined> {
    return this.store.getEvidence(id);
  }

  /** Whether evidence already exists for a given source. Surfaces that sweep a
   *  source repeatedly (the CLI folder watcher) use this to stay idempotent
   *  across restarts instead of re-ingesting everything. */
  async hasEvidenceSource(source: string): Promise<boolean> {
    return this.store.hasEvidenceSource(source);
  }

  /** True when a model and an embedding provider are both configured, so
   *  distillation can run. Surfaces (the CLI) use this to distill on ingest when
   *  they can, and to print a clear next step when they cannot, instead of
   *  silently storing evidence that never becomes product truth. */
  get canDistill(): boolean {
    return this.model !== undefined && this.embedding !== undefined;
  }

  /**
   * Optional: turn an image (a whiteboard photo) into evidence text through the
   * vision provider, append only. If no vision provider is configured it fails
   * loud and the rest of Marrow is unaffected. The produced text is normal
   * evidence, so spans into it work like any other.
   */
  async ingestImage(image: Uint8Array, source: string, mediaType?: string): Promise<string> {
    if (!this.vision) {
      throw new Error(
        "ingestImage needs a vision provider. configure one, or use text ingest instead.",
      );
    }
    const text = await this.vision.describeImage(image, mediaType);
    const evidence = await this.store.insertEvidence({ text, source });
    return evidence.id;
  }

  /**
   * Optional: transcribe audio (a voice memo, a recorded standup) into evidence
   * text through the transcription provider, append only. If none is configured
   * it fails loud and the rest of Marrow is unaffected.
   */
  async ingestAudio(audio: Uint8Array, source: string, mediaType?: string): Promise<string> {
    if (!this.transcription) {
      throw new Error(
        "ingestAudio needs a transcription provider. configure one, or use text ingest instead.",
      );
    }
    const text = await this.transcription.transcribe(audio, mediaType);
    const evidence = await this.store.insertEvidence({ text, source });
    return evidence.id;
  }

  async getNodesForEvidence(evidenceId: string): Promise<Distilled[]> {
    return this.store.getNodesForEvidence(evidenceId);
  }

  /**
   * Turn one evidence row into entities, decisions and questions, each cited to
   * an exact span and embedded. Nodes come in as `open` with a model
   * confidence; distillation NEVER produces a decided node. Idempotent: a node
   * whose dedupe key already exists for this evidence is skipped, so re-running
   * does not duplicate. A node whose span does not resolve is dropped, never
   * stored with empty provenance.
   */
  async distill(evidenceId: string): Promise<Distilled[]> {
    if (!this.model || !this.embedding) {
      throw new Error(
        "distill requires a model and an embedding provider. configure MARROW_PROVIDER and an embedding endpoint, or inject them.",
      );
    }
    const evidence = await this.store.getEvidence(evidenceId);
    if (!evidence) throw new Error(`distill: evidence ${evidenceId} not found`);
    const model = this.model;

    // wrap the whole pass in one observability run: latency, the model used,
    // real token usage when the provider reports it, and the node count. a
    // failing distill records an error run and rethrows.
    return traced(this.store, { kind: "distill", label: evidence.source }, async (report) => {
      const existing = await this.store.getNodesForEvidence(evidenceId);
      const seen = new Set(existing.map((node) => nodeKey(node, evidenceId)));
      const created: Distilled[] = [];
      let tokensIn = 0;
      let tokensOut = 0;
      let hasUsage = false;

      const confidenceOf = (value: number | undefined) =>
        ({ value: value ?? 0.6, source: "model" }) as const;

      // one model call per chunk; every quote is resolved back into the FULL
      // evidence text, so spans stay correct no matter where a chunk boundary fell.
      for (const chunk of chunkText(evidence.text, DISTILL_CHUNK_CHARS)) {
        const opts = {
          system: DISTILL_SYSTEM,
          temperature: 0,
          maxTokens: DISTILL_MAX_TOKENS,
        };
        let raw: string;
        if (model.completeDetailed) {
          const completion = await model.completeDetailed(buildDistillPrompt(chunk), opts);
          raw = completion.text;
          if (completion.usage) {
            tokensIn += completion.usage.inputTokens;
            tokensOut += completion.usage.outputTokens;
            hasUsage = true;
          }
        } else {
          raw = await model.complete(buildDistillPrompt(chunk), opts);
        }
        const extraction = parseExtraction(raw);

        for (const entity of extraction.entities) {
          const span = resolveSpan(evidence.text, entity);
          if (!span) continue;
          const key = distilledKey("entity", entity.name, span.start, span.end);
          if (seen.has(key)) continue;
          seen.add(key);
          const node = await this.store.insertEntity({
            name: entity.name,
            ...(entity.description !== undefined ? { description: entity.description } : {}),
            status: "open",
            confidence: confidenceOf(entity.confidence),
            provenance: [{ evidenceId, start: span.start, end: span.end }],
          });
          await this.embedNode(node.id, "entity", entity.name);
          created.push(node);
        }

        for (const decision of extraction.decisions) {
          const span = resolveSpan(evidence.text, decision);
          if (!span) continue;
          const key = distilledKey("decision", decision.title, span.start, span.end);
          if (seen.has(key)) continue;
          seen.add(key);
          const node = await this.store.insertDecision({
            title: decision.title,
            rationale: decision.rationale ?? "",
            constraint: decision.constraint ?? false,
            status: "open",
            confidence: confidenceOf(decision.confidence),
            provenance: [{ evidenceId, start: span.start, end: span.end }],
          });
          await this.embedNode(
            node.id,
            "decision",
            `${decision.title} ${decision.rationale ?? ""}`,
          );
          created.push(node);
        }

        for (const goal of extraction.goals) {
          const span = resolveSpan(evidence.text, goal);
          if (!span) continue;
          const key = distilledKey("goal", goal.title, span.start, span.end);
          if (seen.has(key)) continue;
          seen.add(key);
          const node = await this.store.insertGoal({
            title: goal.title,
            ...(goal.description !== undefined ? { description: goal.description } : {}),
            goalType: goal.goalType,
            status: "open",
            confidence: confidenceOf(goal.confidence),
            provenance: [{ evidenceId, start: span.start, end: span.end }],
          });
          await this.embedNode(node.id, "goal", `${goal.title} ${goal.description ?? ""}`);
          created.push(node);
        }

        for (const question of extraction.questions) {
          const span = resolveSpan(evidence.text, question);
          if (!span) continue;
          const key = distilledKey("question", question.prompt, span.start, span.end);
          if (seen.has(key)) continue;
          seen.add(key);
          const node = await this.store.insertQuestion({
            prompt: question.prompt,
            status: "open",
            confidence: confidenceOf(question.confidence),
            provenance: [{ evidenceId, start: span.start, end: span.end }],
          });
          await this.embedNode(node.id, "question", question.prompt);
          created.push(node);
        }
      }

      report({
        model: model.model,
        ...(hasUsage ? { tokensIn, tokensOut } : {}),
        inputSummary: `${evidence.text.length} chars`,
        outputSummary: `${created.length} new node${created.length === 1 ? "" : "s"}`,
        metadata: { evidenceId, newNodes: created.length },
      });
      return [...existing, ...created];
    });
  }

  /** Ingest, distill, then reconcile against the graph synchronously. This is the
   *  in-process path (tests, the demo); it does not enqueue, so it never double
   *  processes when a queue is also wired. */
  async ingestAndDistill(input: IngestInput): Promise<{ evidenceId: string; nodes: Distilled[] }> {
    const evidence = await this.store.insertEvidence({ text: input.text, source: input.source });
    await this.distill(evidence.id);
    await this.linkAndMerge(evidence.id);
    return { evidenceId: evidence.id, nodes: await this.store.getNodesForEvidence(evidence.id) };
  }

  /**
   * Resolve the nodes of one evidence against the existing graph. One concept
   * becomes one node (entities with the same normalized name merge, keeping
   * every provenance span); a new decision that contradicts a decided one is
   * marked contested and raises a Question; an entity nobody decided anything
   * about raises a gap Question. Nothing is ever auto-resolved or overwritten:
   * every signal is an open Question for a human.
   */
  async linkAndMerge(evidenceId: string): Promise<void> {
    // 1. entity resolution: merge a new entity into an existing one by name.
    for (const node of await this.store.getNodesForEvidence(evidenceId)) {
      if (node.kind !== "entity") continue;
      const normalized = normalizeTitle(node.name);
      const canonical = (await this.store.findEntities(node.name)).find(
        (candidate) => candidate.id !== node.id && normalizeTitle(candidate.name) === normalized,
      );
      if (canonical) {
        await this.store.addProvenance(canonical.id, "entity", node.provenance);
        await this.store.deleteEntity(node.id);
      }
    }

    // 2. conflict detection: a new decision against the rest of the decision
    //    graph, not just the decided part. a conflict with a DECIDED decision
    //    contests the new one; a conflict between two not-yet-decided decisions
    //    (e.g. two contradictions in the same room before anything is settled)
    //    just raises a question. neither is ever auto-resolved, and a conflict
    //    already asked is not re-raised.
    const allDecisions = await this.store.listDecisions();
    for (const node of await this.store.getNodesForEvidence(evidenceId)) {
      if (node.kind !== "decision") continue;
      for (const other of allDecisions) {
        if (other.id === node.id) continue;
        const term = decisionsConflict(node, other);
        if (!term) continue;
        if (await this.store.hasQuestionRelating(node.id, other.id)) continue;
        if (other.status === "decided") await this.store.markDecisionContested(node.id);
        await this.store.insertQuestion({
          prompt: `possible conflict: "${node.title}" may contradict "${other.title}" (both touch "${term}"). which one holds?`,
          relatesTo: [node.id, other.id],
          status: "open",
          confidence: { value: 0.5, source: "model" },
          provenance: node.provenance,
        });
        // record the conflict as a graph edge too, so it is walkable. an edge
        // carries no status: the question above is still what a human resolves.
        await this.store.insertEdge({
          fromId: node.id,
          fromKind: "decision",
          toId: other.id,
          toKind: "decision",
          relation: "conflicts_with",
          confidence: 0.5,
          source: "rule",
          evidenceId,
        });
        break;
      }
    }

    // 3. gap detection: an entity with no decision about it.
    const decisions = await this.store.listDecisions();
    const openQuestions = await this.store.getOpenQuestions();
    for (const node of await this.store.getNodesForEvidence(evidenceId)) {
      if (node.kind !== "entity") continue;
      // concerns edges: link the entity to every decision that is about it, so
      // retrieval can walk from a feature to the choices made about it.
      for (const decision of decisionsConcerningEntity(node, decisions)) {
        await this.store.insertEdge({
          fromId: node.id,
          fromKind: "entity",
          toId: decision.id,
          toKind: "decision",
          relation: "concerns",
          confidence: 0.6,
          source: "rule",
          evidenceId,
        });
      }
      if (entityHasDecision(node, decisions)) continue;
      const alreadyAsked = openQuestions.some(
        (q) => (q.relatesTo ?? []).includes(node.id) && /never decided|specify it/i.test(q.prompt),
      );
      if (alreadyAsked) continue;
      await this.store.insertQuestion({
        prompt: `the room mentions "${node.name}" but never decided anything about it. want to specify it?`,
        relatesTo: [node.id],
        status: "open",
        confidence: { value: 0.4, source: "model" },
        provenance: node.provenance,
      });
    }

    // 4. goal conflict: two goals that contradict on a shared term. mirrors the
    //    decision-conflict path: raise a question (deduped), never auto-resolve.
    //    confidence sits below decision conflict (0.5) since goals are softer.
    const allGoals = await this.store.listGoals();
    for (const node of await this.store.getNodesForEvidence(evidenceId)) {
      if (node.kind !== "goal") continue;
      for (const other of allGoals) {
        if (other.id === node.id) continue;
        const term = goalsConflict(node, other);
        if (!term) continue;
        if (await this.store.hasQuestionRelating(node.id, other.id)) continue;
        await this.store.insertQuestion({
          prompt: `possible goal conflict: "${node.title}" may contradict "${other.title}" (both touch "${term}"). which one holds?`,
          relatesTo: [node.id, other.id],
          status: "open",
          confidence: { value: 0.4, source: "model" },
          provenance: node.provenance,
        });
        await this.store.insertEdge({
          fromId: node.id,
          fromKind: "goal",
          toId: other.id,
          toKind: "goal",
          relation: "conflicts_with",
          confidence: 0.4,
          source: "rule",
          evidenceId,
        });
        break;
      }
    }

    // 5. Goal gap: a goal not attached to any feature/product entity. Raise ONE
    //    conservative question asking what it serves, deduped so re-distilling
    //    the same evidence never piles up duplicates.
    const goalGapQuestions = await this.store.getOpenQuestions();
    for (const node of await this.store.getNodesForEvidence(evidenceId)) {
      if (node.kind !== "goal") continue;
      if (node.entityId) {
        // serves edge: make the existing goal -> entity link walkable.
        await this.store.insertEdge({
          fromId: node.id,
          fromKind: "goal",
          toId: node.entityId,
          toKind: "entity",
          relation: "serves",
          confidence: 0.9,
          source: "rule",
          evidenceId,
        });
        continue;
      }
      const alreadyAsked = goalGapQuestions.some(
        (q) => (q.relatesTo ?? []).includes(node.id) && /feature or product/i.test(q.prompt),
      );
      if (alreadyAsked) continue;
      await this.store.insertQuestion({
        prompt: `the goal "${node.title}" is not attached to any feature or product. which one does it serve?`,
        relatesTo: [node.id],
        status: "open",
        confidence: { value: 0.4, source: "model" },
        provenance: node.provenance,
      });
    }
  }

  async findEntities(query: string): Promise<Entity[]> {
    return this.store.findEntities(query);
  }

  /** Open questions ordered by impact: a contested decision outranks a gap. */
  async getOpenQuestions(): Promise<Question[]> {
    return rankQuestions(await this.store.getOpenQuestions());
  }

  async getDecision(id: string): Promise<Decision | undefined> {
    return this.store.getDecision(id);
  }

  /**
   * Bounded, task-scoped search across the graph. semantic first: when an
   * embedding provider is configured the query is embedded and ranked against
   * the node embeddings by cosine distance, so a paraphrase finds the decision
   * even with no shared words. keyword (substring) hits fill any remaining slots
   * and are the sole path when no embedder is configured. never the whole brain.
   */
  async search(query: string, k = 8): Promise<Distilled[]> {
    return traced(this.store, { kind: "search", label: query.slice(0, 80) }, async (report) => {
      const { results, mode } = await this.runSearch(query, k);
      report({
        outputSummary: `${results.length} hit${results.length === 1 ? "" : "s"}`,
        metadata: { k, hits: results.length, mode },
      });
      return results;
    });
  }

  private async runSearch(
    query: string,
    k = 8,
  ): Promise<{ results: Distilled[]; mode: "semantic" | "keyword" }> {
    if (this.embedding) {
      const queryVector = await this.embedQuery(query);
      if (queryVector) {
        const semantic = await this.store.nearestNodes(queryVector, k);
        if (semantic.length >= k) return { results: semantic, mode: "semantic" };
        const have = new Set(semantic.map((n) => n.id));
        for (const node of await this.store.searchNodes(query, k)) {
          if (have.has(node.id)) continue;
          semantic.push(node);
          have.add(node.id);
          if (semantic.length >= k) break;
        }
        return { results: semantic, mode: "semantic" };
      }
    }
    return { results: await this.store.searchNodes(query, k), mode: "keyword" };
  }

  async getDecisions(filter: { status?: Status } = {}): Promise<Decision[]> {
    return this.store.listDecisions(filter);
  }

  /** Goals, optionally filtered by status, goal type, or the entity they serve. */
  async getGoals(
    filter: { status?: Status; goalType?: "product" | "user"; entityId?: string } = {},
  ): Promise<Goal[]> {
    return this.store.listGoals(filter);
  }

  async getGoal(id: string): Promise<Goal | undefined> {
    return this.store.getGoal(id);
  }

  async getEntity(idOrName: string): Promise<Entity | undefined> {
    const byId = await this.store.getEntity(idOrName);
    if (byId) return byId;
    const [first] = await this.store.findEntities(idOrName);
    return first;
  }

  async listEntities(): Promise<Entity[]> {
    return this.store.listEntities();
  }

  /**
   * The front door: a bounded list of every node with its one-line title, status
   * and degree (how connected it is), the hubs first. Titles only, never bodies
   * or provenance, so an agent can see what exists before searching without
   * pulling the whole brain.
   */
  async getIndex(limit = 200): Promise<IndexEntry[]> {
    return this.store.listIndex(limit);
  }

  /**
   * The brain as a graph for the console map: the bounded set of nodes (id, kind,
   * one-line title, status, degree) and the edges among them. Only edges whose
   * both endpoints are in the node set are returned, so the map is self-contained.
   * Titles only, never bodies or provenance.
   */
  async getGraph(nodeLimit = 200, edgeLimit = 800): Promise<BrainGraph> {
    const nodes = await this.store.listIndex(nodeLimit);
    const ids = new Set(nodes.map((node) => node.id));
    const edges: GraphEdge[] = (await this.store.listEdges(edgeLimit))
      .filter((edge) => ids.has(edge.fromId) && ids.has(edge.toId))
      .map((edge) => ({ from: edge.fromId, to: edge.toId, relation: edge.relation }));
    return { nodes, edges };
  }

  /**
   * The nodes linked to one node in the knowledge graph: the decisions about a
   * feature, the goal it serves, the facts it conflicts with or supersedes. Each
   * carries the relation and hop distance. Bounded (never the whole brain) and
   * read only: walking edges changes no status.
   */
  async getNeighbors(nodeId: string, maxHops = 1): Promise<NeighborsBrief> {
    const node = await this.store.getNode(nodeId);
    if (!node) return { node: undefined, neighbors: [] };
    const hops = Math.max(1, Math.min(2, Math.round(maxHops)));
    // the direct edges give the relation + confidence for 1-hop neighbors.
    const directed = new Map<string, { relation: Relation; edgeConfidence: number }>();
    for (const edge of await this.store.edgesFor(nodeId)) {
      const other = edge.fromId === nodeId ? edge.toId : edge.fromId;
      if (!directed.has(other)) {
        directed.set(other, { relation: edge.relation, edgeConfidence: edge.confidence });
      }
    }
    const reached = await this.store.neighbors([nodeId], [node.kind], hops, 50);
    const neighbors: NeighborLink[] = [];
    for (const nb of reached) {
      const n = await this.store.getNode(nb.id);
      if (!n) continue;
      const link = directed.get(nb.id);
      neighbors.push({
        id: n.id,
        kind: n.kind,
        title: nodeTitle(n),
        status: n.status,
        depth: nb.depth,
        ...(link !== undefined ? link : {}),
      });
    }
    return {
      node: { id: node.id, kind: node.kind, title: nodeTitle(node), status: node.status },
      neighbors,
    };
  }

  private async briefNode(node: Distilled): Promise<BriefNode> {
    const trace = await this.traceToSource(node.id);
    return {
      id: node.id,
      kind: node.kind,
      title: nodeTitle(node),
      status: node.status,
      confidence: node.confidence,
      provenance: trace.spans,
      ...(node.verifiedAt !== undefined ? { verifiedAt: node.verifiedAt } : {}),
      ...(isFactStale(node) ? { stale: true } : {}),
      ...(node.kind === "goal" ? { goalType: node.goalType } : {}),
      ...(node.kind === "goal" && node.entityId !== undefined ? { entityId: node.entityId } : {}),
      ...(node.kind === "question" && node.relatesTo !== undefined
        ? { relatesTo: node.relatesTo }
        : {}),
      ...(node.kind === "decision" ? { constraint: node.constraint } : {}),
    };
  }

  private async briefNodes(nodes: Distilled[], limit: number): Promise<BriefNode[]> {
    const out: BriefNode[] = [];
    for (const node of nodes.slice(0, limit)) out.push(await this.briefNode(node));
    return out;
  }

  /**
   * The agent decision gate. It returns only the task-relevant slice: decided
   * goals/decisions that are safe to build from, open questions and contested
   * facts that need a human first, and optional drift catches for the current
   * diff. Every returned fact is expanded to exact provenance spans.
   */
  async prepareTask(
    task: string,
    options: {
      check?: boolean | undefined;
      repoPath?: string | undefined;
      scope?: "unstaged" | "staged" | string | undefined;
      semantic?: boolean | undefined;
      hunks?: DiffHunk[] | undefined;
    } = {},
  ): Promise<TaskBrief> {
    const search = await this.runSearch(task, 12);
    // Walk the graph out from the top search hits so a fact one or two hops from
    // the task, even with no shared words, can enter the brief. This is the step
    // that makes retrieval get stronger as the graph grows, and it is one bounded
    // query. It stays inside prepare_task: search() is left flat, so the token
    // benchmark is unaffected and the whole brain is never returned.
    const boost = new Map<string, number>();
    for (const node of search.results) boost.set(node.id, 10);
    const seeds = search.results.slice(0, 5);
    if (seeds.length > 0) {
      const neighbors = await this.store.neighbors(
        seeds.map((n) => n.id),
        seeds.map((n) => n.kind),
        2,
        50,
      );
      for (const nb of neighbors) {
        if (boost.has(nb.id)) continue; // a seed keeps its higher boost
        boost.set(nb.id, nb.depth === 1 ? 4 : 2);
      }
    }
    const [decidedDecisions, decidedGoals, contestedDecisions, contestedGoals, openQuestions] =
      await Promise.all([
        this.store.listDecisions({ status: "decided" }),
        this.store.listGoals({ status: "decided" }),
        this.store.listDecisions({ status: "contested" }),
        this.store.listGoals({ status: "contested" }),
        this.getOpenQuestions(),
      ]);

    const safeFacts = relevantOnly(task, boost, [...decidedGoals, ...decidedDecisions]);
    const contestedFacts = relevantOnly(task, boost, [...contestedGoals, ...contestedDecisions]);
    const questionNodes = relevantOnly(task, boost, openQuestions);

    let driftQuestions: BriefNode[] = [];
    let check: TaskBrief["check"] | undefined;
    if (options.check === true) {
      const drift = await this.driftScan(options.repoPath ?? process.cwd(), {
        ...(options.scope !== undefined ? { scope: options.scope } : {}),
        semantic: options.semantic !== false,
        ...(options.hunks !== undefined ? { hunks: options.hunks } : {}),
        trigger: "loop",
      });
      const createdQuestions = drift.created.filter(
        (node): node is Question => node.kind === "question",
      );
      driftQuestions = await this.briefNodes(createdQuestions, BRIEF_LIMIT);
      const receiptData: NonNullable<TaskBrief["check"]>["receiptData"] = [];
      for (const question of createdQuestions) {
        try {
          receiptData.push(await this.renderCatchReceipt(question.id));
        } catch {
          // Goal drift has no decision receipt. The question still carries its
          // repo evidence span and catch event id.
        }
      }
      check = {
        createdDriftQuestions: driftQuestions,
        catchEventIds: drift.events,
        receiptData,
        nextCommands: createdQuestions.map((question) => ({
          questionId: question.id,
          accept: `marrow accept ${question.id} --text "..."`,
          dismiss: `marrow dismiss ${question.id} --reason "..."`,
        })),
      };
    }

    const questions = [...driftQuestions, ...(await this.briefNodes(questionNodes, BRIEF_LIMIT))];
    const askHumanFirst = {
      questions: uniqueBriefNodes(questions).slice(0, BRIEF_LIMIT),
      contestedFacts: await this.briefNodes(contestedFacts, BRIEF_LIMIT),
    };
    const status =
      askHumanFirst.questions.length > 0 || askHumanFirst.contestedFacts.length > 0
        ? "ask_human_first"
        : "safe_to_build";

    return {
      task,
      status,
      safeToBuild: { facts: await this.briefNodes(safeFacts, BRIEF_LIMIT) },
      askHumanFirst,
      ...(check !== undefined ? { check } : {}),
    };
  }

  /**
   * Product truth maintenance: the human-facing loop that shows which decided
   * goals define the current truth, what is proposed or contested, what gaps are
   * unanswered, which catches are pending, and whether ingest may be stale.
   */
  async maintainTruth(): Promise<TruthMaintenanceBrief> {
    const [decidedGoals, decidedDecisions, openGoals, contestedGoals, contestedDecisions] =
      await Promise.all([
        this.store.listGoals({ status: "decided" }),
        this.store.listDecisions({ status: "decided" }),
        this.store.listGoals({ status: "open" }),
        this.store.listGoals({ status: "contested" }),
        this.store.listDecisions({ status: "contested" }),
      ]);
    const openQuestions = await this.getOpenQuestions();
    const gapQuestions = (await this.briefNodes(openQuestions, 500)).filter(isGapQuestion);
    const pendingCatches = await this.pendingCatchReceipts();
    const connectors = await this.listConnectors();
    const now = Date.now();
    const staleMs = 7 * 24 * 60 * 60 * 1000;
    const connectorHealth = connectors.map((connector) => {
      const state = connector.state;
      const stale =
        connector.enabled &&
        state?.lastRunAt !== undefined &&
        now - new Date(state.lastRunAt).getTime() > staleMs;
      const status: TruthMaintenanceBrief["connectorHealth"][number]["status"] = !connector.enabled
        ? "disabled"
        : state === null
          ? "never"
          : stale
            ? "stale"
            : state.lastStatus;
      return {
        name: connector.name,
        kind: connector.kind,
        enabled: connector.enabled,
        status,
        ...(state?.lastRunAt !== undefined ? { lastRunAt: state.lastRunAt } : {}),
        ...(state?.lastError !== undefined ? { lastError: state.lastError } : {}),
        totalItems: state?.totalItems ?? 0,
        hasSecret: connector.hasSecret,
      };
    });

    const openProposedGoals = await this.briefNodes(openGoals, TRUTH_LIMIT);
    const contestedFacts = await this.briefNodes(
      [...contestedGoals, ...contestedDecisions],
      TRUTH_LIMIT,
    );
    const nextActions: string[] = [];
    if (openProposedGoals.length > 0) {
      nextActions.push("Promote or reject proposed goals so agents know which goals are decided.");
    }
    if (contestedFacts.length > 0) {
      nextActions.push("Resolve contested goals or decisions before agents build on that area.");
    }
    if (gapQuestions.length > 0) {
      nextActions.push("Answer gap questions, especially goals without a served feature.");
    }
    if (pendingCatches.length > 0) {
      nextActions.push("Accept or dismiss recent drift catches.");
    }
    if (
      connectorHealth.some(
        (c) => c.status === "never" || c.status === "error" || c.status === "stale",
      )
    ) {
      nextActions.push("Run or repair stale connectors so the room stays current.");
    }
    const staleDecided = [...decidedGoals, ...decidedDecisions].filter((node) => isFactStale(node));
    if (staleDecided.length > 0) {
      nextActions.push(
        `Reverify ${staleDecided.length} decided fact${staleDecided.length === 1 ? "" : "s"} that may be stale.`,
      );
    }
    if (nextActions.length === 0) nextActions.push("No immediate maintenance action.");

    return {
      sourceOfTruth: {
        decidedGoals: await this.briefNodes(decidedGoals, TRUTH_LIMIT),
        decidedDecisions: await this.briefNodes(decidedDecisions, TRUTH_LIMIT),
      },
      openProposedGoals,
      contestedFacts,
      gapQuestions: gapQuestions.slice(0, TRUTH_LIMIT),
      pendingCatches,
      connectorHealth,
      nextActions,
    };
  }

  private async pendingCatchReceipts(): Promise<TruthMaintenanceBrief["pendingCatches"]> {
    const surfaced = await this.store.listCatchEvents({ eventType: "catch_surfaced" });
    const out: TruthMaintenanceBrief["pendingCatches"] = [];
    const seen = new Set<string>();
    for (const event of surfaced) {
      if (!event.question_id || seen.has(event.question_id)) continue;
      const question = await this.store.getQuestion(event.question_id);
      if (!question || question.status !== "open") continue;
      const events = await this.store.listCatchEvents({ questionId: question.id });
      if (
        events.some((e) => e.event_type === "catch_acted_on" || e.event_type === "catch_dismissed")
      ) {
        continue;
      }
      try {
        out.push(await this.renderCatchReceipt(question.id));
        seen.add(question.id);
      } catch {
        // Not every catch is a decision receipt. Skip unsanitizable receipts.
      }
      if (out.length >= TRUTH_LIMIT) break;
    }
    return out;
  }

  /**
   * One-time, read-only repo scan. seeds proposed (open, low-confidence)
   * entities as repo-sourced hints and raises a question for code with no
   * product evidence behind it. It never writes to the repo and never creates a
   * decided node: the room decides, the code only reflects.
   */
  async onboardingScan(repoPath: string): Promise<{ nodes: Distilled[]; questions: Distilled[] }> {
    const candidates = await scanRepo(repoPath);
    const known = new Set((await this.store.listEntities()).map((e) => normalizeTitle(e.name)));
    const nodes: Distilled[] = [];
    const questions: Distilled[] = [];
    for (const candidate of candidates) {
      // Repo evidence is append-only with a `repo:` source so it is always
      // distinguishable from room evidence, and it is never distilled.
      const evidence = await this.store.insertEvidence({
        text: candidate.snippet,
        source: `repo:${candidate.where}`,
      });
      const span = { evidenceId: evidence.id, start: 0, end: candidate.snippet.length };
      nodes.push(
        await this.proposeNode({
          kind: "entity",
          name: candidate.name,
          description: "repo-sourced hint",
          provenance: [span],
          confidence: 0.3,
        }),
      );
      if (!known.has(normalizeTitle(candidate.name))) {
        questions.push(
          await this.proposeNode({
            kind: "question",
            prompt: `the code has "${candidate.name}" (${candidate.where}) but the room never explained why. want to tell me?`,
            provenance: [span],
            confidence: 0.3,
          }),
        );
      }
    }
    return { nodes, questions };
  }

  /**
   * Opt-in, read-only drift detection. Compares the working tree diff against
   * decided facts and raises an open Question when new code contradicts a
   * decision. It writes nothing to the repo, never creates or edits a decided
   * node, and is off when `enabled` is false. Divergence is the human's to
   * resolve; drift only flags it.
   *
   * PR-17: diff-scoped, with rule + semantic layers, per-catch events, and
   * precise file/line provenance.
   */
  async driftScan(
    repoPath: string,
    options: {
      enabled?: boolean | undefined;
      scope?: "unstaged" | "staged" | string | undefined;
      semantic?: boolean | undefined;
      hunks?: DiffHunk[] | undefined;
      trigger?: string | undefined;
      synthetic?: boolean | undefined;
    } = {},
  ): Promise<{ created: Distilled[]; events: number[] }> {
    return traced(this.store, { kind: "drift", label: repoPath }, async (report) => {
      const result = await this.runDriftScan(repoPath, options);
      report({
        ...(options.semantic !== false && this.model ? { model: this.model.model } : {}),
        outputSummary: `${result.created.length} catch${result.created.length === 1 ? "" : "es"}`,
        metadata: { catches: result.created.length, events: result.events.length },
      });
      return result;
    });
  }

  private async runDriftScan(
    repoPath: string,
    options: {
      enabled?: boolean | undefined;
      scope?: "unstaged" | "staged" | string | undefined;
      semantic?: boolean | undefined;
      hunks?: DiffHunk[] | undefined;
      trigger?: string | undefined;
      synthetic?: boolean | undefined;
    } = {},
  ): Promise<{ created: Distilled[]; events: number[] }> {
    if (options.enabled === false) return { created: [], events: [] };
    const trigger = options.trigger ?? "manual";
    const synthetic = options.synthetic ?? false;
    const useSemantic = options.semantic !== false && this.model !== undefined;

    const hunks = options.hunks ?? (await readGitDiff(repoPath, options.scope ?? "unstaged"));
    if (hunks.length === 0) return { created: [], events: [] };

    // maintenance watches decided decisions (constraints) AND decided goals
    // (aspirations). either is enough to make a scan worthwhile.
    const decided = await this.store.listDecisions({ status: "decided" });
    const decidedGoals = await this.store.listGoals({ status: "decided" });
    if (decided.length === 0 && decidedGoals.length === 0) return { created: [], events: [] };

    const created: Distilled[] = [];
    const events: number[] = [];
    const evidenceForHunk = new Map<DiffHunk, Evidence>();

    const evidenceOf = async (hunk: DiffHunk): Promise<Evidence> => {
      const cached = evidenceForHunk.get(hunk);
      if (cached) return cached;
      const text = `${hunk.path}:${hunk.lineStart}-${hunk.lineEnd}\n${hunk.newLines}`;
      const ev = await this.store.insertEvidence({
        text,
        source: `repo:${hunk.path}:${hunk.lineStart}-${hunk.lineEnd}`,
      });
      evidenceForHunk.set(hunk, ev);
      return ev;
    };

    const hunkSignature = (hunk: DiffHunk): string =>
      `${hunk.path}:${hunk.lineStart}-${hunk.lineEnd}`;

    // load prior catch events (surfaced or dismissed) so we do not recreate the
    // same catch after a human dismisses it, and so multiple hunks for the same
    // decision are each surfaced once.
    const priorCatchSignatures = new Set<string>();
    for (const decision of decided) {
      const decisionEvents = await this.store.listCatchEvents({ decisionId: decision.id });
      for (const event of decisionEvents) {
        const e = event as { diff_span?: { path?: string; lineStart?: number; lineEnd?: number } };
        if (e.diff_span?.path !== undefined) {
          priorCatchSignatures.add(
            `${decision.id}:${e.diff_span.path}:${e.diff_span.lineStart}-${e.diff_span.lineEnd}`,
          );
        }
      }
    }

    // rule layer: high-recall candidate generation.
    interface Candidate {
      decision: Decision;
      hunk: DiffHunk;
      hunkIndex: number;
      signal: NonNullable<ReturnType<typeof ruleDriftSignal>>;
    }
    const ruleCandidates: Candidate[] = [];
    for (let hunkIndex = 0; hunkIndex < hunks.length; hunkIndex += 1) {
      const hunk = hunks[hunkIndex];
      if (!hunk) continue;
      for (const decision of decided) {
        const signature = `${decision.id}:${hunkSignature(hunk)}`;
        if (priorCatchSignatures.has(signature)) continue;
        const signal = ruleDriftSignal(hunk.newLines, decision);
        if (signal) ruleCandidates.push({ decision, hunk, hunkIndex, signal });
      }
    }

    // semantic layer: precision filter over rule candidates when a model is
    // configured. if the model call fails, fall back to rule-only.
    const semanticScores = new Map<string, number>();
    if (useSemantic && ruleCandidates.length > 0) {
      const uniqueHunks = [...new Map(ruleCandidates.map((c) => [c.hunkIndex, c.hunk])).values()];
      const hunkIndexMap = new Map(uniqueHunks.map((h, i) => [h, i]));
      try {
        const semantic = await semanticDriftCheck(this.model, decided, uniqueHunks);
        for (const candidate of ruleCandidates) {
          const localIndex = hunkIndexMap.get(candidate.hunk) ?? -1;
          const match = semantic.find(
            (s) => s.decisionId === candidate.decision.id && s.hunkIndex === localIndex,
          );
          if (match)
            semanticScores.set(`${candidate.decision.id}:${candidate.hunkIndex}`, match.confidence);
        }
      } catch {
        // model unavailable or misbehaving: keep rule scores.
      }
    }

    const createdSignatures = new Set<string>();
    for (const candidate of ruleCandidates) {
      const semanticKey = `${candidate.decision.id}:${candidate.hunkIndex}`;
      const semanticConfidence = semanticScores.get(semanticKey);
      let confidence: number;
      if (semanticConfidence !== undefined) {
        if (semanticConfidence < SEMANTIC_CONFIDENCE_THRESHOLD) continue;
        confidence = semanticConfidence;
      } else {
        confidence = candidate.signal.confidence;
        if (confidence < 0.6) continue;
      }

      const signature = `${candidate.decision.id}:${hunkSignature(candidate.hunk)}`;
      if (createdSignatures.has(signature)) continue;
      createdSignatures.add(signature);

      const ev = await evidenceOf(candidate.hunk);
      const snippet = ev.text;
      const question = await this.proposeNode({
        kind: "question",
        prompt: `drift: the code in ${candidate.hunk.path}:${candidate.hunk.lineStart}-${candidate.hunk.lineEnd} may contradict the decided fact "${candidate.decision.title}". is the code drifting?`,
        relatesTo: [candidate.decision.id],
        provenance: [{ evidenceId: ev.id, start: 0, end: snippet.length }],
        confidence,
      });
      created.push(question);

      const eventId = await this.store.insertCatchEvent({
        eventType: "catch_surfaced",
        questionId: question.id,
        decisionId: candidate.decision.id,
        repoPath,
        diffSpan: {
          path: candidate.hunk.path,
          lineStart: candidate.hunk.lineStart,
          lineEnd: candidate.hunk.lineEnd,
          hunkText: candidate.hunk.newLines.slice(0, 2000),
        },
        trigger,
        synthetic,
        modelUsed: useSemantic ? this.model?.model : undefined,
        confidence,
      });
      events.push(eventId);
    }

    // Goal drift: aspirational targets the code may be moving away from. Rule-
    // only and lower-confidence than decision drift. The ONLY outputs are the
    // hunk captured as immutable evidence, a question for a human (relating to
    // the goal via relatesTo, since catch_events has no goal_id column), and a
    // catch event. The decided goal's status/title/confidence are NEVER touched:
    // The room decides, the code reflects, Marrow watches the gap.
    if (decidedGoals.length > 0) {
      // dedup like the existing question creation: skip a goal+hunk we already
      // raised an open drift question for.
      const openGoalQuestions = await this.store.getOpenQuestions();
      const alreadyAsked = (goalId: string, sig: string): boolean =>
        openGoalQuestions.some(
          (q) =>
            (q.relatesTo ?? []).includes(goalId) &&
            /^goal drift:/i.test(q.prompt) &&
            q.prompt.includes(sig),
        );
      const createdGoalSignatures = new Set<string>();
      for (const hunk of hunks) {
        if (!hunk) continue;
        const sig = hunkSignature(hunk);
        for (const goal of decidedGoals) {
          const signature = `${goal.id}:${sig}`;
          if (createdGoalSignatures.has(signature)) continue;
          if (alreadyAsked(goal.id, sig)) continue;
          const signal = goalDriftSignal(hunk.newLines, goal);
          if (!signal || signal.confidence < GOAL_DRIFT_THRESHOLD) continue;
          createdGoalSignatures.add(signature);

          const ev = await evidenceOf(hunk);
          const question = await this.proposeNode({
            kind: "question",
            prompt: `goal drift: the code in ${sig} may contradict the goal "${goal.title}". is the code drifting from the goal?`,
            relatesTo: [goal.id],
            provenance: [{ evidenceId: ev.id, start: 0, end: ev.text.length }],
            confidence: signal.confidence,
          });
          created.push(question);

          const eventId = await this.store.insertCatchEvent({
            eventType: "catch_surfaced",
            questionId: question.id,
            repoPath,
            diffSpan: {
              path: hunk.path,
              lineStart: hunk.lineStart,
              lineEnd: hunk.lineEnd,
              hunkText: hunk.newLines.slice(0, 2000),
            },
            trigger,
            synthetic,
            confidence: signal.confidence,
          });
          events.push(eventId);
        }
      }
    }

    return { created, events };
  }

  /**
   * Accept a surfaced catch: the human acted on it. Records the resolution as
   * answer-style evidence, marks the question decided (the contradiction has been
   * addressed), and writes a catch_acted_on event. The related decision stays
   * decided; the action is the human's record of what they did about the drift.
   */
  async acceptCatch(questionId: string, resolution: string): Promise<Question> {
    if (!resolution || resolution.trim().length === 0) {
      throw new Error("accept: a resolution is required");
    }
    const question = await this.store.getQuestion(questionId);
    if (!question) throw new Error(`accept: question ${questionId} not found`);
    if (question.status !== "open") {
      throw new Error(`accept: question ${questionId} is ${question.status}, not open`);
    }
    if (!/^drift:/i.test(question.prompt)) {
      throw new Error(`accept: question ${questionId} is not a drift catch`);
    }

    let relatesToDecided = false;
    let decisionId: string | undefined;
    for (const id of question.relatesTo ?? []) {
      const node = await this.store.getNode(id);
      if (node?.kind === "decision") {
        decisionId = id;
        if (node.status === "decided") {
          relatesToDecided = true;
          break;
        }
      }
    }
    if (!relatesToDecided) {
      throw new Error(`accept: question ${questionId} does not relate to a decided decision`);
    }

    const evidence = await this.store.insertEvidence({
      text: resolution,
      source: `resolutions/${questionId}`,
    });
    const span = { evidenceId: evidence.id, start: 0, end: resolution.length };
    await this.store.promoteToDecided(questionId, "question", span);

    await this.store.insertCatchEvent({
      eventType: "catch_acted_on",
      questionId,
      decisionId: decisionId!,
      trigger: "manual",
    });

    const updated = await this.store.getQuestion(questionId);
    if (!updated) throw new Error(`accept: question ${questionId} vanished`);
    return updated;
  }

  /**
   * Dismiss a surfaced catch: the human says it is noise. Records the reason as
   * answer-style evidence, marks the question dismissed, and writes a
   * catch_dismissed event.
   */
  async dismissCatch(questionId: string, reason: string): Promise<Question> {
    if (!reason || reason.trim().length === 0) {
      throw new Error("dismiss: a reason is required");
    }
    const question = await this.store.getQuestion(questionId);
    if (!question) throw new Error(`dismiss: question ${questionId} not found`);
    if (question.status !== "open") {
      throw new Error(`dismiss: question ${questionId} is ${question.status}, not open`);
    }
    if (!/^drift:/i.test(question.prompt)) {
      throw new Error(`dismiss: question ${questionId} is not a drift catch`);
    }

    let relatesToDecided = false;
    let decisionId: string | undefined;
    for (const id of question.relatesTo ?? []) {
      const node = await this.store.getNode(id);
      if (node?.kind === "decision") {
        decisionId = id;
        if (node.status === "decided") {
          relatesToDecided = true;
          break;
        }
      }
    }
    if (!relatesToDecided) {
      throw new Error(`dismiss: question ${questionId} does not relate to a decided decision`);
    }

    const evidence = await this.store.insertEvidence({
      text: reason,
      source: `dismissals/${questionId}`,
    });
    const span = { evidenceId: evidence.id, start: 0, end: reason.length };
    await this.store.dismissQuestion(questionId, span);

    await this.store.insertCatchEvent({
      eventType: "catch_dismissed",
      questionId,
      decisionId: decisionId!,
      trigger: "manual",
    });

    const updated = await this.store.getQuestion(questionId);
    if (!updated) throw new Error(`dismiss: question ${questionId} vanished`);
    return updated;
  }

  private async recordQuestionLoopCatchAction(question: Question): Promise<void> {
    if (!/^drift:/i.test(question.prompt)) return;
    const events = await this.store.listCatchEvents({ questionId: question.id });
    if (!events.some((e) => e.event_type === "catch_surfaced")) return;
    if (
      events.some((e) => e.event_type === "catch_acted_on" || e.event_type === "catch_dismissed")
    ) {
      return;
    }
    const surfaced = events.find((e) => e.event_type === "catch_surfaced" && e.decision_id);
    if (!surfaced?.decision_id) return;
    await this.store.insertCatchEvent({
      eventType: "catch_acted_on",
      questionId: question.id,
      decisionId: surfaced.decision_id,
      trigger: "question_loop",
      synthetic: surfaced.synthetic,
    });
  }

  async getNode(id: string): Promise<Distilled | undefined> {
    return this.store.getNode(id);
  }

  /** Render a public catch receipt: a sanitized view of a drift catch that can
   *  be shared with prospects or auditors. It redacts the full evidence text and
   *  only exposes the decision title, hunk path/lines, and provenance labels. */
  async renderCatchReceipt(questionId: string): Promise<{
    id: string;
    status: string;
    decisionTitle: string;
    path: string | undefined;
    lineStart: number | undefined;
    lineEnd: number | undefined;
    sourceLabel: string;
    surfacedAt: string;
  }> {
    const question = await this.store.getQuestion(questionId);
    if (!question) throw new Error(`receipt: question ${questionId} not found`);
    if (!/^drift:/i.test(question.prompt)) {
      throw new Error(`receipt: question ${questionId} is not a drift catch`);
    }

    let decisionTitle = "unknown decision";
    let sourceLabel = "unknown source";
    for (const id of question.relatesTo ?? []) {
      const node = await this.store.getNode(id);
      if (node?.kind === "decision") {
        decisionTitle = node.title;
        // sanitized: expose how many evidence spans back the decision, never the
        // raw source path (which can leak internal file or channel names).
        const spanCount = node.provenance.length;
        sourceLabel = `${spanCount} evidence span${spanCount === 1 ? "" : "s"}`;
        break;
      }
    }

    const events = await this.store.listCatchEvents({ questionId, eventType: "catch_surfaced" });
    const latest = events[events.length - 1];

    return {
      id: question.id,
      status: question.status,
      decisionTitle,
      path: latest?.diff_span?.path,
      lineStart: latest?.diff_span?.lineStart,
      lineEnd: latest?.diff_span?.lineEnd,
      sourceLabel,
      surfacedAt: question.createdAt,
    };
  }

  /**
   * Aggregate catch instrumentation into product metrics. excludes synthetic
   * events by default so eval fixtures do not pollute real brain metrics.
   */
  async catchMetrics(
    options: {
      since?: string | undefined;
      until?: string | undefined;
      includeSynthetic?: boolean | undefined;
    } = {},
  ) {
    return this.store.getCatchMetrics({
      since: options.since,
      until: options.until,
      excludeSynthetic: options.includeSynthetic !== true,
    });
  }

  /**
   * Resolve a node's provenance to its exact source spans: the evidence label
   * and the verbatim spanned text. This is the trace back the agent shows so a
   * fact can always be checked against the room.
   */
  async traceToSource(nodeId: string): Promise<TraceResult> {
    const node = await this.store.getNode(nodeId);
    if (!node) throw new Error(`trace: node ${nodeId} not found`);
    const spans: TraceSpan[] = [];
    for (const span of node.provenance) {
      const evidence = await this.store.getEvidence(span.evidenceId);
      if (!evidence) continue;
      spans.push({
        evidenceId: span.evidenceId,
        source: evidence.source,
        createdAt: evidence.createdAt,
        start: span.start,
        end: span.end,
        spanText: evidence.text.slice(span.start, span.end),
      });
    }
    const first = spans[0];
    return { nodeId, source: first?.source, spanText: first?.spanText, spans };
  }

  /**
   * Add a proposed node to the graph. always `open` with a model confidence:
   * the agent proposes, only a human answer (the question loop) promotes to
   * decided. there is deliberately no parameter to set status here.
   */
  /**
   * The skeptic. It attacks every open, model-proposed fact with a fresh context
   * (it sees only the node's own evidence and the decided facts it might
   * contradict, never the conversation that proposed it) and records a verdict:
   * survived, or flagged with reasons (single source, weak provenance, or it
   * contradicts a decided fact). A contradiction raises a normal question a human
   * still answers. It NEVER promotes a node: this reinforces the propose/promote
   * gate, it does not bypass it.
   */
  async verify(): Promise<VerifyReport> {
    const [openDecisions, openGoals, decided] = await Promise.all([
      this.store.listDecisions({ status: "open" }),
      this.store.listGoals({ status: "open" }),
      this.store.listDecisions({ status: "decided" }),
    ]);
    const proposed: Distilled[] = [...openDecisions, ...openGoals].filter(
      (node) => node.confidence.source === "model",
    );
    const results: VerifyResult[] = [];
    for (const node of proposed) {
      const conflict =
        node.kind === "decision"
          ? decided.find((other) => other.id !== node.id && decisionsConflict(node, other))
          : undefined;
      const reasons = skepticReasons(node, conflict !== undefined);
      const verdict = verdictFor(reasons);
      await this.store.insertVerification({
        nodeId: node.id,
        nodeKind: node.kind,
        verdict,
        reasons,
      });
      // a contradiction against a decided fact is escalated to the human loop,
      // deduped, exactly like a conflict found at distill time. never auto-resolved.
      if (conflict && !(await this.store.hasQuestionRelating(node.id, conflict.id))) {
        await this.store.insertQuestion({
          prompt: `verify: the proposed "${nodeTitle(node)}" may contradict the decided "${conflict.title}". which one holds?`,
          relatesTo: [node.id, conflict.id],
          status: "open",
          confidence: { value: 0.5, source: "model" },
          provenance: node.provenance,
        });
      }
      results.push({ nodeId: node.id, kind: node.kind, title: nodeTitle(node), verdict, reasons });
    }
    return {
      checked: proposed.length,
      survived: results.filter((result) => result.verdict === "survived").length,
      flagged: results.filter((result) => result.verdict === "flagged").length,
      results,
    };
  }

  async proposeNode(input: ProposeInput): Promise<Distilled> {
    const confidence = { value: input.confidence ?? 0.5, source: "model" as const };
    if (input.kind === "entity") {
      const node = await this.store.insertEntity({
        name: input.name,
        ...(input.description !== undefined ? { description: input.description } : {}),
        status: "open",
        confidence,
        provenance: input.provenance,
      });
      await this.embedNode(node.id, "entity", input.name);
      return node;
    }
    if (input.kind === "decision") {
      const node = await this.store.insertDecision({
        title: input.title,
        rationale: input.rationale ?? "",
        constraint: input.constraint ?? false,
        status: "open",
        confidence,
        provenance: input.provenance,
      });
      await this.embedNode(node.id, "decision", `${input.title} ${input.rationale ?? ""}`);
      return node;
    }
    if (input.kind === "goal") {
      const node = await this.store.insertGoal({
        title: input.title,
        ...(input.description !== undefined ? { description: input.description } : {}),
        goalType: input.goalType,
        ...(input.entityId !== undefined ? { entityId: input.entityId } : {}),
        status: "open",
        confidence,
        provenance: input.provenance,
      });
      await this.embedNode(node.id, "goal", `${input.title} ${input.description ?? ""}`);
      return node;
    }
    const node = await this.store.insertQuestion({
      prompt: input.prompt,
      ...(input.relatesTo !== undefined ? { relatesTo: input.relatesTo } : {}),
      status: "open",
      confidence,
      provenance: input.provenance,
    });
    await this.embedNode(node.id, "question", input.prompt);
    return node;
  }

  /**
   * Author a goal directly. unlike proposeNode this is a HUMAN action: the
   * product team states a goal they have committed to, so it lands `decided`
   * with a human confidence. provenance still holds: the authored text is
   * captured as a new, immutable evidence row (INSERT only, never an update) and
   * the goal cites that span, so "no fact without provenance" is satisfied by the
   * team's own statement rather than skipped.
   */
  async authorGoal(input: {
    title: string;
    description?: string;
    goalType: "product" | "user";
    entityId?: string;
    source?: string;
  }): Promise<Goal> {
    const text = input.description ? `${input.title}\n${input.description}` : input.title;
    const evidence = await this.store.insertEvidence({
      text,
      source: input.source ?? "goals/console",
    });
    const goal = await this.store.insertGoal({
      title: input.title,
      ...(input.description !== undefined ? { description: input.description } : {}),
      goalType: input.goalType,
      ...(input.entityId !== undefined ? { entityId: input.entityId } : {}),
      status: "decided",
      confidence: { value: 1, source: "human" },
      provenance: [{ evidenceId: evidence.id, start: 0, end: text.length }],
    });
    await this.embedNode(goal.id, "goal", `${input.title} ${input.description ?? ""}`);
    return goal;
  }

  /**
   * Answer an open question. This is the ONLY path that promotes a node to
   * decided. The answer text is appended as immutable evidence, the chosen node
   * is promoted to decided with a human confidence and linked to that answer
   * span, and the question is closed.
   *
   * A conflict question relates to more than one decision; the human must say
   * which one holds (`opts.decide`). We promote ONLY that one and mark the other
   * related decisions superseded. We never promote both sides of a contradiction
   * (the exact failure the loop exists to stop), and we never re-answer a
   * question that is already closed.
   */
  /**
   * Answer several open questions in one call. each entry is processed in order
   * through the same promotion path as answer(); failures stop the batch and the
   * already-committed answers stay committed.
   */
  async answerBatch(
    entries: { questionId: string; text: string; decide?: string }[],
  ): Promise<{ promoted: Distilled[]; superseded: Distilled[] }> {
    const promoted: Distilled[] = [];
    const superseded: Distilled[] = [];
    for (const entry of entries) {
      const result = await this.answer(entry.questionId, entry.text, {
        ...(entry.decide !== undefined ? { decide: entry.decide } : {}),
      });
      promoted.push(...result.promoted);
      superseded.push(...result.superseded);
    }
    return { promoted, superseded };
  }

  async answer(
    questionId: string,
    text: string,
    opts: { decide?: string } = {},
  ): Promise<{ promoted: Distilled[]; superseded: Distilled[] }> {
    const question = await this.store.getQuestion(questionId);
    if (!question) throw new Error(`answer: question ${questionId} not found`);
    if (question.status !== "open") {
      throw new Error(`answer: question ${questionId} is already ${question.status}, not open`);
    }

    // the nodes this answer could promote: existing, non-question related nodes.
    const related: Distilled[] = [];
    for (const id of question.relatesTo ?? []) {
      const node = await this.store.getNode(id);
      if (node && node.kind !== "question") related.push(node);
    }

    let toPromote: Distilled[];
    let toSupersede: Distilled[] = [];
    if (opts.decide !== undefined) {
      const chosen = related.find((n) => n.id === opts.decide);
      if (!chosen) {
        const ids = related.map((n) => n.id).join(", ") || "none";
        throw new Error(
          `answer: ${opts.decide} is not one of this question's related nodes (${ids})`,
        );
      }
      toPromote = [chosen];
      // a conflict answer supersedes the losing side: a decision or a goal. (a
      // related entity stays, it is not a competing claim.)
      toSupersede = related.filter(
        (n) => n.id !== chosen.id && (n.kind === "decision" || n.kind === "goal"),
      );
    } else if (related.length <= 1) {
      toPromote = related;
    } else {
      const ids = related.map((n) => n.id).join(", ");
      throw new Error(
        `answer: this question relates to ${related.length} decisions (${ids}); say which one holds by passing it as the chosen decision (decide). both sides are never promoted.`,
      );
    }

    const evidence = await this.store.insertEvidence({ text, source: `answers/${questionId}` });
    const span = { evidenceId: evidence.id, start: 0, end: text.length };

    const promoted: Distilled[] = [];
    for (const node of toPromote) {
      await this.store.promoteToDecided(node.id, node.kind, span);
      const updated = await this.store.getNode(node.id);
      if (updated) promoted.push(updated);
    }
    const superseded: Distilled[] = [];
    for (const node of toSupersede) {
      await this.store.supersede(node.id, node.kind);
      const updated = await this.store.getNode(node.id);
      if (updated) superseded.push(updated);
    }

    // record the supersede as a graph edge (winner -> loser). this is the one
    // human-authored edge: the answer's evidence justifies it. the promote and
    // supersede above already set the statuses; the edge changes nothing.
    const winner = toPromote[0];
    if (winner && toSupersede.length > 0) {
      for (const loser of toSupersede) {
        await this.store.insertEdge({
          fromId: winner.id,
          fromKind: winner.kind,
          toId: loser.id,
          toKind: loser.kind,
          relation: "supersedes",
          confidence: 1,
          source: "human",
          evidenceId: evidence.id,
        });
      }
    }

    // Answering can spawn follow-up questions: a node just promoted to decided
    // may now contradict another decided decision. Raise it (deduped), never
    // auto-resolve.
    const decided = await this.store.listDecisions({ status: "decided" });
    for (const node of promoted) {
      if (node.kind !== "decision") continue;
      for (const other of decided) {
        if (other.id === node.id) continue;
        const term = decisionsConflict(node, other);
        if (!term) continue;
        if (await this.store.hasQuestionRelating(node.id, other.id)) continue;
        await this.store.insertQuestion({
          prompt: `follow-up conflict: the now-decided "${node.title}" may contradict the decided "${other.title}" (both touch "${term}"). which one holds?`,
          relatesTo: [node.id, other.id],
          status: "open",
          confidence: { value: 0.5, source: "model" },
          provenance: node.provenance,
        });
        break;
      }
    }

    await this.store.resolveQuestion(questionId);
    await this.recordQuestionLoopCatchAction(question);
    return { promoted, superseded };
  }

  async searchEvidence(query: string): Promise<Evidence[]> {
    return this.store.searchEvidence(query);
  }

  // --- observability + connectors facade ------------------------------------
  // One API for every surface (cloud, web, cli) over the runs trace and the
  // connector spine. Reads delegate to the store; writes encrypt secrets and
  // drive the SyncEngine.

  /** Recent runs (the observability trace), newest first, bounded and filterable. */
  async getRuns(filter: RunFilter = {}): Promise<RunRecord[]> {
    return this.store.listRuns(filter);
  }

  async getRun(id: string): Promise<RunRecord | undefined> {
    return this.store.getRun(id);
  }

  /** Aggregate observability metrics over a window. */
  async getRunMetrics(filter: { since?: string; until?: string } = {}): Promise<RunMetrics> {
    return this.store.runMetrics(filter);
  }

  /** Every configured connector merged with its live sync state. */
  async listConnectors(): Promise<ConnectorSummary[]> {
    const [configs, states] = await Promise.all([
      this.store.listConnectorConfigs(),
      this.store.listConnectorState(),
    ]);
    const byName = new Map(states.map((s) => [s.name, s]));
    return configs.map((c) => ({ ...c, state: byName.get(c.name) ?? null }));
  }

  /** Configure a connector. The secret is encrypted at rest before it is
   *  stored; an omitted secret keeps any existing one. */
  async upsertConnector(input: {
    name: string;
    kind: string;
    enabled?: boolean;
    settings?: Record<string, unknown>;
    secret?: string;
  }): Promise<ConnectorConfigRecord> {
    if (!CONNECTOR_KINDS.includes(input.kind as ConnectorKind)) {
      throw new Error(
        `unknown connector kind "${input.kind}". known kinds: ${CONNECTOR_KINDS.join(", ")}`,
      );
    }
    const secretCipher = input.secret ? encryptSecret(input.secret) : undefined;
    return this.store.upsertConnectorConfig({
      name: input.name,
      kind: input.kind,
      enabled: input.enabled ?? true,
      settings: input.settings ?? {},
      ...(secretCipher !== undefined ? { secretCipher } : {}),
    });
  }

  async setConnectorEnabled(name: string, enabled: boolean): Promise<void> {
    await this.store.setConnectorEnabled(name, enabled);
  }

  async deleteConnector(name: string): Promise<void> {
    await this.store.deleteConnectorConfig(name);
  }

  /** Run one connector's sync now: pull since its cursor, dedup, ingest new
   *  evidence, advance the cursor on success, record a run. idempotent. */
  async syncConnector(name: string): Promise<ConnectorSyncResult> {
    return new SyncEngine({ store: this.store, enqueuer: this.enqueuer }).runConnector(name);
  }

  /** Run every enabled connector's sync now. */
  async syncAllConnectors(): Promise<ConnectorSyncResult[]> {
    return new SyncEngine({ store: this.store, enqueuer: this.enqueuer }).runAll();
  }

  private async embedNode(
    nodeId: string,
    nodeKind: "entity" | "decision" | "question" | "goal",
    text: string,
  ): Promise<void> {
    if (!this.embedding) return;
    const result = await this.embedding.embed([text]);
    const vector = result.vectors[0];
    if (!vector) return;
    await this.store.insertEmbedding({
      nodeId,
      nodeKind,
      model: result.model,
      dim: result.dim,
      vector,
    });
  }

  /** Embed a search query with the configured provider, or undefined if there is
   *  no embedder or it returns nothing. used by search to rank semantically. */
  private async embedQuery(query: string): Promise<number[] | undefined> {
    if (!this.embedding) return undefined;
    const result = await this.embedding.embed([query]);
    return result.vectors[0];
  }

  async close(): Promise<void> {
    await this.store.close();
  }
}

/** Build a Marrow core from DATABASE_URL, wiring providers from env if they are
 *  configured. distillation fails loud later if it is used without them. */
export function createMarrow(databaseUrl: string | undefined = process.env.DATABASE_URL): Marrow {
  const store = createStore(databaseUrl);
  let config;
  try {
    config = loadProviderConfig();
  } catch {
    // providers are optional for ingest and reads; distill fails loud if used.
    return new Marrow(store);
  }
  // each provider is wired independently: a claude-only user has a model and
  // vision but no embedding endpoint, and distill (not vision) is what fails loud.
  let embedding: EmbeddingProvider | undefined;
  try {
    embedding = createEmbeddingProvider(config);
  } catch {
    embedding = undefined;
  }
  return new Marrow(
    store,
    createModelProvider(config),
    embedding,
    undefined,
    createVisionProvider(config),
    createTranscriptionProvider(config),
  );
}
