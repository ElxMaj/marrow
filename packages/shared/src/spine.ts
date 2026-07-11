import { z } from "zod";

// The knowledge spine. These zod schemas are the single source of truth for the
// four node kinds; every type below is inferred from its schema, never hand
// written. No database, no embeddings, no IO live here. See PR-01.
//
// Shared identity types live at the bottom so the same package carries the
// contracts between core and web without adding IO.

/** The states a distilled fact can be in. Nothing outside these is valid. */
export const StatusSchema = z.enum(["open", "decided", "contested", "superseded", "dismissed"]);
export type Status = z.infer<typeof StatusSchema>;

/**
 * Confidence on a distilled fact. `value` is a probability in 0..1 and out of
 * range is rejected, not clamped silently. `source` records whether a model or
 * a human stands behind the fact, which is how decided is told from proposed.
 */
export const ConfidenceSchema = z.object({
  value: z.number().min(0, "confidence cannot be below 0").max(1, "confidence cannot be above 1"),
  source: z.enum(["model", "human"]),
});
export type Confidence = z.infer<typeof ConfidenceSchema>;

/**
 * One link back to an exact range of characters in an evidence row. `start` and
 * `end` are character offsets into that evidence's text, and `end >= start`.
 */
export const ProvenanceSpanSchema = z
  .object({
    evidenceId: z.string().min(1),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  })
  .refine((s) => s.end >= s.start, {
    message: "provenance span end must be >= start",
    path: ["end"],
  });
export type ProvenanceSpan = z.infer<typeof ProvenanceSpanSchema>;

/** Every distilled node carries at least one span. There is no "trust me" fact. */
export const ProvenanceSchema = z
  .array(ProvenanceSpanSchema)
  .min(1, "a distilled node needs at least one evidence span");
export type Provenance = z.infer<typeof ProvenanceSchema>;

const Iso = z.string().datetime({ message: "expected an ISO 8601 timestamp" });

// Fields shared by every distilled node (Entity, Decision, Question, Goal).
// Evidence deliberately does not get these: it is the root of provenance, not a
// fact.
const distilledFields = {
  id: z.string().min(1),
  status: StatusSchema,
  confidence: ConfidenceSchema,
  provenance: ProvenanceSchema,
  createdAt: Iso,
  updatedAt: Iso,
} as const;

/**
 * Raw, verbatim substrate. Evidence has NO status and NO provenance: it is the
 * thing provenance points at. Captured once, never mutated.
 */
export const EvidenceSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("evidence"),
  text: z.string(),
  source: z.string().min(1),
  createdAt: Iso,
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/** A thing the product talks about (a feature, integration, module, concept). */
export const EntitySchema = z.object({
  kind: z.literal("entity"),
  name: z.string().min(1),
  description: z.string().optional(),
  ...distilledFields,
});
export type Entity = z.infer<typeof EntitySchema>;

/** A choice the room made. `constraint` flags a hard constraint, not a separate kind. */
export const DecisionSchema = z.object({
  kind: z.literal("decision"),
  title: z.string().min(1),
  rationale: z.string(),
  constraint: z.boolean(),
  ...distilledFields,
});
export type Decision = z.infer<typeof DecisionSchema>;

/**
 * A target or outcome the room committed to. Distinct from a Decision (a
 * choice): a goal is what the product or its users must achieve. `goalType`
 * separates a product goal (what the product must do) from a user goal (what a
 * user must be able to do). `entityId` attaches the goal to the feature or
 * product entity it serves; optional because distillation may surface a goal
 * before its entity resolves, and an unattached goal raises a gap question
 * rather than guessing. It is the only structural link, and it points at an
 * Entity node, never at code: a goal is never derived from the repo.
 */
export const GoalSchema = z.object({
  kind: z.literal("goal"),
  title: z.string().min(1),
  description: z.string().optional(),
  goalType: z.enum(["product", "user"]),
  entityId: z.string().optional(),
  ...distilledFields,
});
export type Goal = z.infer<typeof GoalSchema>;

/** An open thread: ambiguity, a conflict, or a gap the loop wants a human to settle. */
export const QuestionSchema = z.object({
  kind: z.literal("question"),
  prompt: z.string().min(1),
  relatesTo: z.array(z.string()).optional(),
  ...distilledFields,
});
export type Question = z.infer<typeof QuestionSchema>;

/** The discriminated union over the node kinds. narrow on `kind`. */
export const NodeSchema = z.discriminatedUnion("kind", [
  EvidenceSchema,
  EntitySchema,
  DecisionSchema,
  QuestionSchema,
  GoalSchema,
]);
export type Node = z.infer<typeof NodeSchema>;

// parse helpers. types are inferred, so a parsed value is already the type.
export const parseEvidence = (input: unknown): Evidence => EvidenceSchema.parse(input);
export const parseEntity = (input: unknown): Entity => EntitySchema.parse(input);
export const parseDecision = (input: unknown): Decision => DecisionSchema.parse(input);
export const parseQuestion = (input: unknown): Question => QuestionSchema.parse(input);
export const parseGoal = (input: unknown): Goal => GoalSchema.parse(input);
export const parseNode = (input: unknown): Node => NodeSchema.parse(input);

// ---------------------------------------------------------------------------
// The knowledge graph edge. A distilled node can relate to another distilled
// node, and those links are what let retrieval walk the web instead of only
// searching it (a search index gets noisier as it grows; a linked graph gets
// stronger). An edge is advisory structure, never a fact: it carries a
// confidence and a source, never a status, and it never promotes a node.
// Evidence is never a graph endpoint: it is the root of provenance, not part of
// the distilled web.
// ---------------------------------------------------------------------------

/** The distilled kinds an edge can connect. Evidence is excluded on purpose. */
export const EdgeNodeKindSchema = z.enum(["entity", "decision", "question", "goal"]);
export type EdgeNodeKind = z.infer<typeof EdgeNodeKindSchema>;

/** How an edge was asserted: a write-time rule, a model, or a human answer. */
export const EdgeSourceSchema = z.enum(["rule", "model", "human"]);
export type EdgeSource = z.infer<typeof EdgeSourceSchema>;

/**
 * The typed relations between two distilled nodes.
 * - `concerns`: an entity is the subject of a decision.
 * - `serves`: a goal serves the entity it is attached to.
 * - `supersedes`: a decided node replaced this one when a conflict was answered.
 * - `refines`: a decision narrows an earlier one without replacing it.
 * - `conflicts_with`: two nodes disagree and a human has not settled it.
 * - `relates_to`: a looser link, e.g. a question about a set of nodes.
 */
export const RelationSchema = z.enum([
  "concerns",
  "serves",
  "supersedes",
  "refines",
  "conflicts_with",
  "relates_to",
]);
export type Relation = z.infer<typeof RelationSchema>;

/**
 * One directed edge in the knowledge graph. `evidenceId` links it to the span
 * that justifies it, when there is one (a merge-derived edge cites the node's own
 * span). `id` is assigned by the store.
 */
export const EdgeSchema = z.object({
  id: z.number().int().nonnegative(),
  fromId: z.string().min(1),
  fromKind: EdgeNodeKindSchema,
  toId: z.string().min(1),
  toKind: EdgeNodeKindSchema,
  relation: RelationSchema,
  confidence: z
    .number()
    .min(0, "confidence cannot be below 0")
    .max(1, "confidence cannot be above 1"),
  source: EdgeSourceSchema,
  evidenceId: z.string().min(1).optional(),
  createdAt: Iso,
});
export type Edge = z.infer<typeof EdgeSchema>;

export const parseEdge = (input: unknown): Edge => EdgeSchema.parse(input);

// ---------------------------------------------------------------------------
// Observability and connector sync. a Run is an append-only trace of one
// model, retrieval, drift, or connector operation, so the pipeline that turns
// the room into product truth is measurable (latency, tokens, cost, errors) in
// the same Postgres. ConnectorState is the incremental cursor and health for a
// live connector. kept in shared so core, cli, MCP, and web share one contract.
// ---------------------------------------------------------------------------

/** The kinds of work Marrow records a run for. */
export const RunKindSchema = z.enum(["distill", "search", "drift", "connector_sync", "ingest"]);
export type RunKind = z.infer<typeof RunKindSchema>;

export const RunStatusSchema = z.enum(["ok", "error"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

/**
 * One recorded operation. written once at completion and never mutated: like a
 * log line, a run is the immutable record of what happened. tokens and cost are
 * optional because not every provider surfaces usage and not every run calls a
 * model (a keyword search has none).
 */
export const RunRecordSchema = z.object({
  id: z.string().min(1),
  kind: RunKindSchema,
  status: RunStatusSchema,
  label: z.string().optional(),
  model: z.string().optional(),
  tokensIn: z.number().int().nonnegative().optional(),
  tokensOut: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  latencyMs: z.number().nonnegative(),
  inputSummary: z.string().optional(),
  outputSummary: z.string().optional(),
  error: z.string().optional(),
  parentId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: Iso,
});
export type RunRecord = z.infer<typeof RunRecordSchema>;

/** Per-kind rollup inside RunMetrics. */
export const RunKindMetricsSchema = z.object({
  count: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  avgLatencyMs: z.number().nonnegative(),
});
export type RunKindMetrics = z.infer<typeof RunKindMetricsSchema>;

/** Aggregate observability over a window: the numbers the dashboard shows. */
export const RunMetricsSchema = z.object({
  count: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  totalTokensIn: z.number().int().nonnegative(),
  totalTokensOut: z.number().int().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
  p50LatencyMs: z.number().nonnegative(),
  p95LatencyMs: z.number().nonnegative(),
  byKind: z.record(RunKindMetricsSchema),
});
export type RunMetrics = z.infer<typeof RunMetricsSchema>;

export const ConnectorStatusSchema = z.enum(["ok", "error", "never"]);
export type ConnectorStatus = z.infer<typeof ConnectorStatusSchema>;

/**
 * The incremental sync state for one connector. Mutable on purpose: the cursor
 * advances each successful run. This is not evidence, it is the bookmark that
 * lets a connector pull only what is new.
 */
export const ConnectorStateSchema = z.object({
  name: z.string().min(1),
  cursor: Iso.optional(),
  lastRunAt: Iso.optional(),
  lastStatus: ConnectorStatusSchema,
  lastError: z.string().optional(),
  itemsLastRun: z.number().int().nonnegative().optional(),
  totalItems: z.number().int().nonnegative(),
  enabled: z.boolean(),
  updatedAt: Iso,
});
export type ConnectorState = z.infer<typeof ConnectorStateSchema>;

/** The result of one connector sync. surfaced to the CLI, MCP, and web. */
export const ConnectorSyncResultSchema = z.object({
  name: z.string().min(1),
  itemsIngested: z.number().int().nonnegative(),
  itemsSkipped: z.number().int().nonnegative(),
  status: RunStatusSchema,
  error: z.string().optional(),
  runId: z.string().min(1),
});
export type ConnectorSyncResult = z.infer<typeof ConnectorSyncResultSchema>;

/**
 * A stored connector configuration. `settings` holds the non-secret fields
 * (channel ids, base urls, queries); `hasSecret` reports whether a secret
 * (token, api key) is stored, without ever exposing it. The brain's own
 * Postgres holds these, next to the state they drive.
 */
export const ConnectorConfigRecordSchema = z.object({
  name: z.string().min(1),
  kind: z.string().min(1),
  enabled: z.boolean(),
  settings: z.record(z.unknown()),
  hasSecret: z.boolean(),
  createdAt: Iso,
  updatedAt: Iso,
});
export type ConnectorConfigRecord = z.infer<typeof ConnectorConfigRecordSchema>;

/** A connector's config merged with its live sync state, for dashboards. */
export const ConnectorSummarySchema = ConnectorConfigRecordSchema.extend({
  state: ConnectorStateSchema.nullable(),
});
export type ConnectorSummary = z.infer<typeof ConnectorSummarySchema>;
