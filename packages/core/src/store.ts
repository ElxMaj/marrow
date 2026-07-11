import { randomUUID } from "node:crypto";

import {
  type Confidence,
  type ConnectorConfigRecord,
  ConnectorConfigRecordSchema,
  type ConnectorState,
  ConnectorStateSchema,
  type Decision,
  DecisionSchema,
  type Edge,
  EdgeSchema,
  type EdgeNodeKind,
  type EdgeSource,
  type Entity,
  EntitySchema,
  type Evidence,
  type Goal,
  GoalSchema,
  type Provenance,
  ProvenanceSchema,
  type ProvenanceSpan,
  type Question,
  QuestionSchema,
  type Relation,
  type RunKind,
  type RunMetrics,
  type RunRecord,
  RunRecordSchema,
  type RunStatus,
  type Status,
} from "@marrowhq/shared";
import pg from "pg";

const { Pool } = pg;

// Fixed first key for every connector advisory lock, so the per-connector lock
// space (second key = hashtext(name)) cannot collide with another lock usage.
const CONNECTOR_LOCK_NS = 19794; // "MR", for Marrow

// Draft inputs. The Store generates id, createdAt and updatedAt and sets kind,
// so callers pass only the fields they own. Every distilled draft must carry
// provenance: there is no path to a node without a source span.
export interface EvidenceDraft {
  text: string;
  source: string;
}

interface DistilledDraft {
  status: Status;
  confidence: Confidence;
  provenance: Provenance;
}

export interface EntityDraft extends DistilledDraft {
  name: string;
  description?: string;
}

export interface DecisionDraft extends DistilledDraft {
  title: string;
  rationale: string;
  constraint: boolean;
}

export interface QuestionDraft extends DistilledDraft {
  prompt: string;
  relatesTo?: string[];
}

export interface GoalDraft extends DistilledDraft {
  title: string;
  description?: string;
  goalType: "product" | "user";
  entityId?: string;
}

/** A directed edge to insert. The store stamps id and created_at. An edge never
 *  carries a status: it is advisory graph structure, not a fact. */
export interface EdgeDraft {
  fromId: string;
  fromKind: EdgeNodeKind;
  toId: string;
  toKind: EdgeNodeKind;
  relation: Relation;
  confidence: number;
  source: EdgeSource;
  evidenceId?: string | undefined;
}

/** A node reached by walking the graph from a seed, with its shortest hop depth. */
export interface Neighbor {
  id: string;
  kind: EdgeNodeKind;
  depth: number;
}

export interface EmbeddingInput {
  nodeId: string;
  nodeKind?: "entity" | "decision" | "question" | "goal" | "evidence";
  model: string;
  dim: number;
  vector: number[];
}

export interface CatchEventDraft {
  eventType: "catch_surfaced" | "catch_acted_on" | "catch_dismissed";
  questionId?: string | undefined;
  decisionId?: string | undefined;
  repoPath?: string | undefined;
  diffSpan?: { path: string; lineStart: number; lineEnd: number; hunkText: string } | undefined;
  trigger: string;
  synthetic?: boolean | undefined;
  modelUsed?: string | undefined;
  confidence?: number | undefined;
}

export interface CatchEvent {
  id: number;
  event_type: "catch_surfaced" | "catch_acted_on" | "catch_dismissed";
  question_id: string | null;
  decision_id: string | null;
  repo_path: string | null;
  diff_span: { path: string; lineStart: number; lineEnd: number; hunkText: string } | null;
  trigger: string;
  synthetic: boolean;
  model_used: string | null;
  confidence: number | null;
  created_at: string;
}

interface CatchEventRow {
  id: string | number;
  event_type: "catch_surfaced" | "catch_acted_on" | "catch_dismissed";
  question_id: string | null;
  decision_id: string | null;
  repo_path: string | null;
  diff_span: string | CatchEvent["diff_span"];
  trigger: string;
  synthetic: boolean;
  model_used: string | null;
  confidence: string | number | null;
  created_at: Date | string;
}

export interface CatchMetrics {
  surfaced: number;
  actedOn: number;
  dismissed: number;
  precision: number | null;
  dismissRate: number | null;
}

// --- observability + connector sync inputs --------------------------------

/** A finished operation to record. The store stamps id and created_at. */
export interface RunDraft {
  kind: RunKind;
  status: RunStatus;
  label?: string | undefined;
  model?: string | undefined;
  tokensIn?: number | undefined;
  tokensOut?: number | undefined;
  costUsd?: number | undefined;
  latencyMs: number;
  inputSummary?: string | undefined;
  outputSummary?: string | undefined;
  error?: string | undefined;
  parentId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface RunFilter {
  kind?: RunKind | undefined;
  status?: RunStatus | undefined;
  before?: string | undefined;
  limit?: number | undefined;
}

/** The outcome of one connector sync, written atomically to connector_state. */
export interface SyncOutcome {
  ok: boolean;
  /** the new high-water mark; only advanced when ok is true. */
  cursor?: string | undefined;
  itemsIngested: number;
  error?: string | undefined;
  ranAt: string;
}

export interface ConnectorConfigDraft {
  name: string;
  kind: string;
  enabled: boolean;
  settings: Record<string, unknown>;
  /** ciphertext for the connector secret; undefined keeps any existing secret. */
  secretCipher?: string | undefined;
}

interface RunRow {
  id: string;
  kind: string;
  status: string;
  label: string | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  latency_ms: number;
  input_summary: string | null;
  output_summary: string | null;
  error: string | null;
  parent_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

interface ConnectorStateRow {
  name: string;
  cursor: Date | null;
  last_run_at: Date | null;
  last_status: string;
  last_error: string | null;
  items_last_run: number | null;
  total_items: number;
  enabled: boolean;
  updated_at: Date;
}

interface ConnectorConfigRow {
  name: string;
  kind: string;
  enabled: boolean;
  settings: Record<string, unknown>;
  secret_cipher: string | null;
  created_at: Date;
  updated_at: Date;
}

type DistilledKind = "entity" | "decision" | "question" | "goal";

interface DistilledRow {
  id: string;
  status: string;
  confidence_value: number;
  confidence_source: string;
  created_at: Date;
  updated_at: Date;
}

const toVectorLiteral = (vector: number[]): string => `[${vector.join(",")}]`;
const iso = (value: Date | string): string => new Date(value).toISOString();

const RUN_SELECT = `select id, kind, status, label, model, tokens_in, tokens_out, cost_usd, latency_ms, input_summary, output_summary, error, parent_id, metadata, created_at from run`;

// table names cannot be bound parameters, so map the typed kind to a fixed
// identifier from a whitelist. Never interpolate caller input into SQL.
function tableForKind(kind: DistilledKind): "entity" | "decision" | "question" | "goal" {
  return kind;
}

function diffSpanLiteral(span: CatchEventDraft["diffSpan"]): string | null {
  if (!span) return null;
  return JSON.stringify(span);
}

function diffSpanFromRow(value: CatchEventRow["diff_span"]): CatchEvent["diff_span"] {
  if (!value) return null;
  if (typeof value === "string") return JSON.parse(value) as CatchEvent["diff_span"];
  return value;
}

function catchEventFromRow(row: CatchEventRow): CatchEvent {
  const id = Number(row.id);
  if (!Number.isFinite(id)) throw new Error("catch event row has invalid id");
  return {
    id,
    event_type: row.event_type,
    question_id: row.question_id,
    decision_id: row.decision_id,
    repo_path: row.repo_path,
    diff_span: diffSpanFromRow(row.diff_span),
    trigger: row.trigger,
    synthetic: row.synthetic,
    model_used: row.model_used,
    confidence: row.confidence === null ? null : Number(row.confidence),
    created_at: iso(row.created_at),
  };
}

/**
 * Escape LIKE/ILIKE wildcards in a user query so `%` and `_` match literally
 * instead of acting as wildcards. Postgres LIKE uses backslash as the default
 * escape character, so escaping `\ % _` is enough — no ESCAPE clause needed.
 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

const EDGE_SELECT = `select id, from_id, from_kind, to_id, to_kind, relation, confidence, source, evidence_id, created_at from edge`;

interface EdgeRow {
  id: string | number;
  from_id: string;
  from_kind: string;
  to_id: string;
  to_kind: string;
  relation: string;
  confidence: string | number;
  source: string;
  evidence_id: string | null;
  created_at: Date | string;
}

function edgeFromRow(row: EdgeRow): Edge {
  // bigserial comes back as a string from pg; Number() it. Parse through the
  // shared schema so the store only ever returns validated shared types.
  return EdgeSchema.parse({
    id: Number(row.id),
    fromId: row.from_id,
    fromKind: row.from_kind,
    toId: row.to_id,
    toKind: row.to_kind,
    relation: row.relation,
    confidence: Number(row.confidence),
    source: row.source,
    ...(row.evidence_id !== null ? { evidenceId: row.evidence_id } : {}),
    createdAt: iso(row.created_at),
  });
}

/**
 * The single store. Postgres with pgvector, the graph as tables. methods take
 * and return the `@marrowhq/shared` types, never raw rows. evidence is insert
 * only: there is deliberately no updateEvidence or deleteEvidence method.
 */
export class Store {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  // --- evidence: append only ------------------------------------------------

  async insertEvidence(draft: EvidenceDraft): Promise<Evidence> {
    const id = `ev_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    await this.pool.query(
      "insert into evidence (id, text, source, created_at) values ($1, $2, $3, $4)",
      [id, draft.text, draft.source, createdAt],
    );
    return { id, kind: "evidence", text: draft.text, source: draft.source, createdAt };
  }

  async getEvidence(id: string): Promise<Evidence | undefined> {
    const res = await this.pool.query<{
      id: string;
      text: string;
      source: string;
      created_at: Date;
    }>("select id, text, source, created_at from evidence where id = $1", [id]);
    const row = res.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      kind: "evidence",
      text: row.text,
      source: row.source,
      createdAt: iso(row.created_at),
    };
  }

  // --- distilled nodes: always with provenance ------------------------------

  async insertEntity(draft: EntityDraft): Promise<Entity> {
    const provenance = ProvenanceSchema.parse(draft.provenance);
    const id = `ent_${randomUUID()}`;
    const ts = new Date().toISOString();
    return this.tx(async (client) => {
      await client.query(
        `insert into entity (id, name, description, status, confidence_value, confidence_source, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [
          id,
          draft.name,
          draft.description ?? null,
          draft.status,
          draft.confidence.value,
          draft.confidence.source,
          ts,
        ],
      );
      await this.insertProvenance(client, id, "entity", provenance);
      const entity: Entity = {
        id,
        kind: "entity",
        name: draft.name,
        ...(draft.description !== undefined ? { description: draft.description } : {}),
        status: draft.status,
        confidence: draft.confidence,
        provenance,
        createdAt: ts,
        updatedAt: ts,
      };
      return EntitySchema.parse(entity);
    });
  }

  async insertDecision(draft: DecisionDraft): Promise<Decision> {
    const provenance = ProvenanceSchema.parse(draft.provenance);
    const id = `dec_${randomUUID()}`;
    const ts = new Date().toISOString();
    return this.tx(async (client) => {
      await client.query(
        `insert into decision (id, title, rationale, is_constraint, status, confidence_value, confidence_source, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [
          id,
          draft.title,
          draft.rationale,
          draft.constraint,
          draft.status,
          draft.confidence.value,
          draft.confidence.source,
          ts,
        ],
      );
      await this.insertProvenance(client, id, "decision", provenance);
      const decision: Decision = {
        id,
        kind: "decision",
        title: draft.title,
        rationale: draft.rationale,
        constraint: draft.constraint,
        status: draft.status,
        confidence: draft.confidence,
        provenance,
        createdAt: ts,
        updatedAt: ts,
      };
      return DecisionSchema.parse(decision);
    });
  }

  async insertQuestion(draft: QuestionDraft): Promise<Question> {
    const provenance = ProvenanceSchema.parse(draft.provenance);
    const id = `q_${randomUUID()}`;
    const ts = new Date().toISOString();
    const relatesTo = draft.relatesTo ?? [];
    return this.tx(async (client) => {
      await client.query(
        `insert into question (id, prompt, relates_to, status, confidence_value, confidence_source, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [
          id,
          draft.prompt,
          relatesTo,
          draft.status,
          draft.confidence.value,
          draft.confidence.source,
          ts,
        ],
      );
      await this.insertProvenance(client, id, "question", provenance);
      const question: Question = {
        id,
        kind: "question",
        prompt: draft.prompt,
        ...(draft.relatesTo !== undefined ? { relatesTo: draft.relatesTo } : {}),
        status: draft.status,
        confidence: draft.confidence,
        provenance,
        createdAt: ts,
        updatedAt: ts,
      };
      return QuestionSchema.parse(question);
    });
  }

  async insertGoal(draft: GoalDraft): Promise<Goal> {
    const provenance = ProvenanceSchema.parse(draft.provenance);
    const id = `goal_${randomUUID()}`;
    const ts = new Date().toISOString();
    return this.tx(async (client) => {
      await client.query(
        `insert into goal (id, title, description, goal_type, entity_id, status, confidence_value, confidence_source, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
        [
          id,
          draft.title,
          draft.description ?? null,
          draft.goalType,
          draft.entityId ?? null,
          draft.status,
          draft.confidence.value,
          draft.confidence.source,
          ts,
        ],
      );
      await this.insertProvenance(client, id, "goal", provenance);
      const goal: Goal = {
        id,
        kind: "goal",
        title: draft.title,
        ...(draft.description !== undefined ? { description: draft.description } : {}),
        goalType: draft.goalType,
        ...(draft.entityId !== undefined ? { entityId: draft.entityId } : {}),
        status: draft.status,
        confidence: draft.confidence,
        provenance,
        createdAt: ts,
        updatedAt: ts,
      };
      return GoalSchema.parse(goal);
    });
  }

  async getDecision(id: string): Promise<Decision | undefined> {
    const res = await this.pool.query<
      DistilledRow & { title: string; rationale: string; is_constraint: boolean }
    >(
      `select id, title, rationale, is_constraint, status, confidence_value, confidence_source, created_at, updated_at
       from decision where id = $1`,
      [id],
    );
    const row = res.rows[0];
    if (!row) return undefined;
    return DecisionSchema.parse({
      id: row.id,
      kind: "decision",
      title: row.title,
      rationale: row.rationale,
      constraint: row.is_constraint,
      provenance: await this.getProvenance(id),
      ...this.distilledCommon(row),
    });
  }

  async getEntity(id: string): Promise<Entity | undefined> {
    const res = await this.pool.query<DistilledRow & { name: string; description: string | null }>(
      `select id, name, description, status, confidence_value, confidence_source, created_at, updated_at
       from entity where id = $1`,
      [id],
    );
    const row = res.rows[0];
    if (!row) return undefined;
    return EntitySchema.parse({
      id: row.id,
      kind: "entity",
      name: row.name,
      ...(row.description !== null ? { description: row.description } : {}),
      provenance: await this.getProvenance(id),
      ...this.distilledCommon(row),
    });
  }

  async getQuestion(id: string): Promise<Question | undefined> {
    const res = await this.pool.query<DistilledRow & { prompt: string; relates_to: string[] }>(
      `select id, prompt, relates_to, status, confidence_value, confidence_source, created_at, updated_at
       from question where id = $1`,
      [id],
    );
    const row = res.rows[0];
    if (!row) return undefined;
    return QuestionSchema.parse({
      id: row.id,
      kind: "question",
      prompt: row.prompt,
      relatesTo: row.relates_to,
      provenance: await this.getProvenance(id),
      ...this.distilledCommon(row),
    });
  }

  async getGoal(id: string): Promise<Goal | undefined> {
    const res = await this.pool.query<
      DistilledRow & {
        title: string;
        description: string | null;
        goal_type: string;
        entity_id: string | null;
      }
    >(
      `select id, title, description, goal_type, entity_id, status, confidence_value, confidence_source, created_at, updated_at
       from goal where id = $1`,
      [id],
    );
    const row = res.rows[0];
    if (!row) return undefined;
    return GoalSchema.parse({
      id: row.id,
      kind: "goal",
      title: row.title,
      ...(row.description !== null ? { description: row.description } : {}),
      goalType: row.goal_type,
      ...(row.entity_id !== null ? { entityId: row.entity_id } : {}),
      provenance: await this.getProvenance(id),
      ...this.distilledCommon(row),
    });
  }

  // --- graph queries and merges --------------------------------------------

  async findEntities(query: string, limit = 20): Promise<Entity[]> {
    const res = await this.pool.query<{ id: string }>(
      "select id from entity where name ilike $1 order by updated_at desc limit $2",
      [`%${escapeLike(query)}%`, limit],
    );
    return this.hydrateEntities(res.rows.map((r) => r.id));
  }

  async listEntities(limit = 500): Promise<Entity[]> {
    const res = await this.pool.query<{ id: string }>(
      "select id from entity order by updated_at desc limit $1",
      [limit],
    );
    return this.hydrateEntities(res.rows.map((r) => r.id));
  }

  async listDecisions(filter: { status?: Status } = {}, limit = 500): Promise<Decision[]> {
    const res = filter.status
      ? await this.pool.query<{ id: string }>(
          "select id from decision where status = $1 order by updated_at desc limit $2",
          [filter.status, limit],
        )
      : await this.pool.query<{ id: string }>(
          "select id from decision order by updated_at desc limit $1",
          [limit],
        );
    const out: Decision[] = [];
    for (const row of res.rows) {
      const decision = await this.getDecision(row.id);
      if (decision) out.push(decision);
    }
    return out;
  }

  async getOpenQuestions(limit = 500): Promise<Question[]> {
    const res = await this.pool.query<{ id: string }>(
      "select id from question where status = 'open' order by created_at desc limit $1",
      [limit],
    );
    const out: Question[] = [];
    for (const row of res.rows) {
      const question = await this.getQuestion(row.id);
      if (question) out.push(question);
    }
    return out;
  }

  async listGoals(
    filter: { status?: Status; goalType?: "product" | "user"; entityId?: string } = {},
    limit = 500,
  ): Promise<Goal[]> {
    const conditions: string[] = [];
    const values: (string | number)[] = [];
    let idx = 1;
    if (filter.status) {
      conditions.push(`status = $${idx++}`);
      values.push(filter.status);
    }
    if (filter.goalType) {
      conditions.push(`goal_type = $${idx++}`);
      values.push(filter.goalType);
    }
    if (filter.entityId) {
      conditions.push(`entity_id = $${idx++}`);
      values.push(filter.entityId);
    }
    const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
    values.push(limit);
    const res = await this.pool.query<{ id: string }>(
      `select id from goal ${where} order by updated_at desc limit $${idx}`,
      values,
    );
    const out: Goal[] = [];
    for (const row of res.rows) {
      const goal = await this.getGoal(row.id);
      if (goal) out.push(goal);
    }
    return out;
  }

  async getOpenGoals(limit = 500): Promise<Goal[]> {
    const res = await this.pool.query<{ id: string }>(
      "select id from goal where status = 'open' order by created_at desc limit $1",
      [limit],
    );
    const out: Goal[] = [];
    for (const row of res.rows) {
      const goal = await this.getGoal(row.id);
      if (goal) out.push(goal);
    }
    return out;
  }

  async getCatchMetrics(
    filter: {
      since?: string | undefined;
      until?: string | undefined;
      excludeSynthetic?: boolean | undefined;
    } = {},
  ): Promise<CatchMetrics> {
    const conditions: string[] = [];
    const values: (string | boolean)[] = [];
    let idx = 1;
    if (filter.since) {
      conditions.push(`created_at >= $${idx++}`);
      values.push(filter.since);
    }
    if (filter.until) {
      conditions.push(`created_at <= $${idx++}`);
      values.push(filter.until);
    }
    if (filter.excludeSynthetic) {
      conditions.push(`synthetic = false`);
    }
    const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
    const res = await this.pool.query<{
      event_type: string;
      count: string;
    }>(
      `select event_type, count(*) as count from catch_events ${where} group by event_type`,
      values,
    );
    const counts = new Map<string, number>();
    for (const row of res.rows) {
      counts.set(row.event_type, Number(row.count));
    }
    const surfaced = counts.get("catch_surfaced") ?? 0;
    const actedOn = counts.get("catch_acted_on") ?? 0;
    const dismissed = counts.get("catch_dismissed") ?? 0;
    const actedOnPlusDismissed = actedOn + dismissed;
    const precision =
      surfaced > 0 && actedOnPlusDismissed > 0 ? actedOn / actedOnPlusDismissed : null;
    const dismissRate = surfaced > 0 ? dismissed / surfaced : null;
    return { surfaced, actedOn, dismissed, precision, dismissRate };
  }

  async listCatchEvents(
    filter: { questionId?: string; decisionId?: string; eventType?: string } = {},
  ): Promise<CatchEvent[]> {
    const conditions: string[] = [];
    const values: (string | boolean)[] = [];
    let idx = 1;
    if (filter.questionId) {
      conditions.push(`question_id = $${idx++}`);
      values.push(filter.questionId);
    }
    if (filter.decisionId) {
      conditions.push(`decision_id = $${idx++}`);
      values.push(filter.decisionId);
    }
    if (filter.eventType) {
      conditions.push(`event_type = $${idx++}`);
      values.push(filter.eventType);
    }
    const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
    const res = await this.pool.query<CatchEventRow>(
      `select id, event_type, question_id, decision_id, repo_path, diff_span, trigger, synthetic, model_used, confidence, created_at
       from catch_events ${where}
       order by created_at desc`,
      values,
    );
    return res.rows.map(catchEventFromRow);
  }

  /** Append provenance spans to an existing distilled node and bump updated_at.
   *  entity resolution uses this to keep every source's span on the merged node.
   *  This never touches evidence: it only adds links to it. */
  async addProvenance(nodeId: string, nodeKind: DistilledKind, spans: Provenance): Promise<void> {
    const table = tableForKind(nodeKind);
    await this.tx(async (client) => {
      await this.insertProvenance(client, nodeId, nodeKind, spans);
      await client.query(`update ${table} set updated_at = $2 where id = $1`, [
        nodeId,
        new Date().toISOString(),
      ]);
    });
  }

  /** Mark a decision contested (a conflict was raised against it). This is the
   *  only status this method sets; it can never reach `decided`. */
  async markDecisionContested(decisionId: string): Promise<void> {
    await this.pool.query(
      "update decision set status = 'contested', updated_at = $2 where id = $1 and status <> 'decided'",
      [decisionId, new Date().toISOString()],
    );
  }

  /** Mark a node superseded: the room chose a different node over this one when
   *  answering a conflict. It never sets `decided`; the chosen side is promoted
   *  separately through promoteToDecided. */
  async supersede(nodeId: string, nodeKind: DistilledKind): Promise<void> {
    const table = tableForKind(nodeKind);
    await this.pool.query(
      `update ${table} set status = 'superseded', updated_at = $2 where id = $1`,
      [nodeId, new Date().toISOString()],
    );
  }

  /**
   * Promote a node to decided. This is the ONLY method that writes the decided
   * status, and core.answer is its only caller: the agent proposes, a human
   * answer promotes. It stamps a human confidence and links the answer span.
   */
  async promoteToDecided(
    nodeId: string,
    nodeKind: DistilledKind,
    span: ProvenanceSpan,
  ): Promise<void> {
    const table = tableForKind(nodeKind);
    await this.tx(async (client) => {
      await client.query(
        `update ${table} set status = 'decided', confidence_source = 'human', confidence_value = 1, updated_at = $2 where id = $1`,
        [nodeId, new Date().toISOString()],
      );
      await this.insertProvenance(client, nodeId, nodeKind, [span]);
    });
  }

  /** Close an answered question: it is no longer open, the answer superseded it. */
  async resolveQuestion(questionId: string): Promise<void> {
    await this.pool.query(
      "update question set status = 'superseded', updated_at = $2 where id = $1",
      [questionId, new Date().toISOString()],
    );
  }

  /** Dismiss a catch question: the human marked it as noise. The reason is
   *  recorded as answer-style evidence and linked as provenance. */
  async dismissQuestion(questionId: string, span: ProvenanceSpan): Promise<void> {
    await this.tx(async (client) => {
      await client.query(
        `update question set status = 'dismissed', confidence_source = 'human', confidence_value = 1, updated_at = $2 where id = $1`,
        [questionId, new Date().toISOString()],
      );
      await this.insertProvenance(client, questionId, "question", [span]);
    });
  }

  /** True if any question (open or resolved) already relates to both nodes. used
   *  to avoid re-raising a follow-up about a conflict that was already asked. */
  async hasQuestionRelating(a: string, b: string): Promise<boolean> {
    const res = await this.pool.query(
      "select 1 from question where relates_to @> $1::text[] limit 1",
      [[a, b]],
    );
    return res.rows.length > 0;
  }

  // --- catch instrumentation -------------------------------------------------

  async insertCatchEvent(draft: CatchEventDraft): Promise<number> {
    const res = await this.pool.query<{ id: string | number }>(
      `insert into catch_events
       (event_type, question_id, decision_id, repo_path, diff_span, trigger, synthetic, model_used, confidence, created_at)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
       returning id`,
      [
        draft.eventType,
        draft.questionId ?? null,
        draft.decisionId ?? null,
        draft.repoPath ?? null,
        diffSpanLiteral(draft.diffSpan),
        draft.trigger,
        draft.synthetic ?? false,
        draft.modelUsed ?? null,
        draft.confidence ?? null,
        new Date().toISOString(),
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error("catch event insert failed");
    const id = Number(row.id);
    if (!Number.isFinite(id)) throw new Error("catch event insert returned invalid id");
    return id;
  }

  /** Search raw evidence text. used to confirm an answer was recorded verbatim. */
  async searchEvidence(query: string, limit = 20): Promise<Evidence[]> {
    const res = await this.pool.query<{
      id: string;
      text: string;
      source: string;
      created_at: Date;
    }>(
      "select id, text, source, created_at from evidence where text ilike $1 order by created_at desc limit $2",
      [`%${escapeLike(query)}%`, limit],
    );
    return res.rows.map((row) => ({
      id: row.id,
      kind: "evidence" as const,
      text: row.text,
      source: row.source,
      createdAt: iso(row.created_at),
    }));
  }

  /** Remove a duplicate distilled entity after its provenance has been merged
   *  into the canonical node. distilled nodes are mergeable; evidence is not. */
  async deleteEntity(entityId: string): Promise<void> {
    await this.tx(async (client) => {
      await client.query("delete from embedding where node_id = $1 and node_kind = 'entity'", [
        entityId,
      ]);
      await client.query("delete from provenance where node_id = $1 and node_kind = 'entity'", [
        entityId,
      ]);
      await client.query("delete from entity where id = $1", [entityId]);
    });
  }

  /** Bounded text search across all node kinds. Never returns the whole
   *  graph: the limit is enforced per kind and on the merged result. */
  async searchNodes(query: string, limit = 8): Promise<(Entity | Decision | Question | Goal)[]> {
    const like = `%${escapeLike(query)}%`;
    const [entities, decisions, questions, goals] = await Promise.all([
      this.pool.query<{ id: string }>(
        "select id from entity where name ilike $1 or coalesce(description, '') ilike $1 order by updated_at desc limit $2",
        [like, limit],
      ),
      this.pool.query<{ id: string }>(
        "select id from decision where title ilike $1 or rationale ilike $1 order by updated_at desc limit $2",
        [like, limit],
      ),
      this.pool.query<{ id: string }>(
        "select id from question where prompt ilike $1 order by updated_at desc limit $2",
        [like, limit],
      ),
      this.pool.query<{ id: string }>(
        "select id from goal where title ilike $1 or coalesce(description, '') ilike $1 order by updated_at desc limit $2",
        [like, limit],
      ),
    ]);
    const out: (Entity | Decision | Question | Goal)[] = [];
    for (const row of entities.rows) {
      const node = await this.getEntity(row.id);
      if (node) out.push(node);
    }
    for (const row of decisions.rows) {
      const node = await this.getDecision(row.id);
      if (node) out.push(node);
    }
    for (const row of questions.rows) {
      const node = await this.getQuestion(row.id);
      if (node) out.push(node);
    }
    for (const row of goals.rows) {
      const node = await this.getGoal(row.id);
      if (node) out.push(node);
    }
    return out.slice(0, limit);
  }

  /** Resolve a distilled node by id across kinds (dispatched by id prefix). */
  async getNode(id: string): Promise<Entity | Decision | Question | Goal | undefined> {
    if (id.startsWith("ent_")) return this.getEntity(id);
    if (id.startsWith("dec_")) return this.getDecision(id);
    if (id.startsWith("q_")) return this.getQuestion(id);
    if (id.startsWith("goal_")) return this.getGoal(id);
    return (
      (await this.getEntity(id)) ??
      (await this.getDecision(id)) ??
      (await this.getQuestion(id)) ??
      (await this.getGoal(id))
    );
  }

  private async hydrateEntities(ids: string[]): Promise<Entity[]> {
    const out: Entity[] = [];
    for (const id of ids) {
      const entity = await this.getEntity(id);
      if (entity) out.push(entity);
    }
    return out;
  }

  // --- embeddings and similarity -------------------------------------------

  async insertEmbedding(input: EmbeddingInput): Promise<void> {
    if (input.vector.length !== input.dim) {
      throw new Error(
        `embedding dim mismatch: declared dim ${input.dim} but vector has ${input.vector.length} values`,
      );
    }
    // Fail loud on a provider switch: the cosine index can only compare vectors
    // from one model at one dimension, so a new (model, dim) silently corrupts
    // retrieval. reject it with a clear message instead (the migration comment
    // promised this is detectable; this is the detection).
    const existing = await this.pool.query<{ embedding_model: string; dim: number }>(
      "select embedding_model, dim from embedding limit 1",
    );
    const row = existing.rows[0];
    if (row && (row.embedding_model !== input.model || row.dim !== input.dim)) {
      throw new Error(
        `embedding provider mismatch: the index holds ${row.embedding_model} (${row.dim}d) but got ${input.model} (${input.dim}d). re-embed the brain after switching the embedding model.`,
      );
    }
    await this.pool.query(
      "insert into embedding (node_id, node_kind, embedding_model, dim, vector) values ($1, $2, $3, $4, $5::vector)",
      [input.nodeId, input.nodeKind ?? null, input.model, input.dim, toVectorLiteral(input.vector)],
    );
  }

  async embeddingProfile(): Promise<{ model: string; dim: number } | undefined> {
    const res = await this.pool.query<{ embedding_model: string; dim: number }>(
      "select embedding_model, dim from embedding limit 1",
    );
    const row = res.rows[0];
    return row ? { model: row.embedding_model, dim: row.dim } : undefined;
  }

  /** Nearest distilled nodes to a query vector by cosine distance, across the
   *  three node kinds. This is the READ side of the embedding spine: nodes are
   *  embedded on creation (distill, propose) and ranked here so task-scoped
   *  retrieval is semantic, not literal substring. Bounded by k. */
  async nearestNodes(
    vector: number[],
    k: number,
  ): Promise<(Entity | Decision | Question | Goal)[]> {
    const res = await this.pool.query<{ node_id: string; node_kind: string }>(
      `select node_id, node_kind
       from embedding
       where node_kind in ('entity', 'decision', 'question', 'goal')
       order by vector <=> $1::vector
       limit $2`,
      [toVectorLiteral(vector), k],
    );
    const out: (Entity | Decision | Question | Goal)[] = [];
    const seen = new Set<string>();
    for (const row of res.rows) {
      if (seen.has(row.node_id)) continue;
      seen.add(row.node_id);
      const node =
        row.node_kind === "entity"
          ? await this.getEntity(row.node_id)
          : row.node_kind === "decision"
            ? await this.getDecision(row.node_id)
            : row.node_kind === "question"
              ? await this.getQuestion(row.node_id)
              : row.node_kind === "goal"
                ? await this.getGoal(row.node_id)
                : undefined;
      if (node) out.push(node);
    }
    return out;
  }

  /** All distilled nodes that cite a given evidence row. distillation uses this
   *  to reconcile a re-run against what already exists instead of duplicating. */
  async getNodesForEvidence(evidenceId: string): Promise<(Entity | Decision | Question | Goal)[]> {
    const res = await this.pool.query<{ node_id: string; node_kind: string }>(
      "select distinct node_id, node_kind from provenance where evidence_id = $1",
      [evidenceId],
    );
    const nodes: (Entity | Decision | Question | Goal)[] = [];
    for (const row of res.rows) {
      const node =
        row.node_kind === "entity"
          ? await this.getEntity(row.node_id)
          : row.node_kind === "decision"
            ? await this.getDecision(row.node_id)
            : row.node_kind === "question"
              ? await this.getQuestion(row.node_id)
              : row.node_kind === "goal"
                ? await this.getGoal(row.node_id)
                : undefined;
      if (node) nodes.push(node);
    }
    return nodes;
  }

  // --- edges: the knowledge graph -------------------------------------------

  /** Insert one directed edge. Idempotent on (from_id, to_id, relation) via the
   *  unique index in 0013, so a re-distill or re-answer that recomputes the same
   *  link never duplicates it. An edge never carries a status and never promotes
   *  a node: it is advisory retrieval structure, not a fact. */
  async insertEdge(draft: EdgeDraft): Promise<void> {
    await this.pool.query(
      `insert into edge (from_id, from_kind, to_id, to_kind, relation, confidence, source, evidence_id, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (from_id, to_id, relation) do nothing`,
      [
        draft.fromId,
        draft.fromKind,
        draft.toId,
        draft.toKind,
        draft.relation,
        draft.confidence,
        draft.source,
        draft.evidenceId ?? null,
        new Date().toISOString(),
      ],
    );
  }

  /** Walk the graph outward from a set of seed nodes, both directions, bounded by
   *  maxHops and a neighbor cap. Returns the reached nodes with their shortest hop
   *  distance, seeds themselves excluded. This is the traversal that lets
   *  prepare_task return a connected neighborhood instead of a flat search list,
   *  and it is pure Postgres, so it works even when no embedding model is set. */
  async neighbors(
    seedIds: string[],
    seedKinds: EdgeNodeKind[],
    maxHops = 2,
    cap = 50,
  ): Promise<Neighbor[]> {
    if (seedIds.length === 0) return [];
    const res = await this.pool.query<{ id: string; kind: string; depth: string | number }>(
      // A recursive CTE allows exactly one recursive arm, so walk both directions
      // in a single arm: join any edge that touches a known node and step to the
      // opposite endpoint. `union` (not `union all`) plus the depth bound make
      // cycles terminate.
      `with recursive nb(id, kind, depth) as (
         select id, kind, 0 from unnest($1::text[], $2::text[]) as seeds(id, kind)
         union
         select
           case when e.from_id = nb.id then e.to_id else e.from_id end,
           case when e.from_id = nb.id then e.to_kind else e.from_kind end,
           nb.depth + 1
           from edge e
           join nb on e.from_id = nb.id or e.to_id = nb.id
          where nb.depth < $3
       )
       select id, kind, min(depth) as depth
         from nb
        where depth > 0 and id <> all($1::text[])
        group by id, kind
        order by min(depth), id
        limit $4`,
      [seedIds, seedKinds, maxHops, cap],
    );
    return res.rows.map((row) => ({
      id: row.id,
      kind: row.kind as EdgeNodeKind,
      depth: Number(row.depth),
    }));
  }

  /** Every edge touching a node, both directions, bounded. For the neighbor tool
   *  and the console map. */
  async edgesFor(nodeId: string, limit = 200): Promise<Edge[]> {
    const res = await this.pool.query<EdgeRow>(
      `${EDGE_SELECT} where from_id = $1 or to_id = $1 order by id limit $2`,
      [nodeId, limit],
    );
    return res.rows.map(edgeFromRow);
  }

  /** How many edges touch a node. */
  async degree(nodeId: string): Promise<number> {
    const res = await this.pool.query<{ n: string | number }>(
      "select count(*) as n from edge where from_id = $1 or to_id = $1",
      [nodeId],
    );
    return Number(res.rows[0]?.n ?? 0);
  }

  /** Degree for a set of nodes at once, including 0 for a node with no edges, so
   *  a front-door index can show how connected each node is without N queries. */
  async degrees(ids: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (ids.length === 0) return out;
    const res = await this.pool.query<{ node_id: string; degree: string | number }>(
      `select n.id as node_id, count(e.id) as degree
         from unnest($1::text[]) as n(id)
         left join edge e on e.from_id = n.id or e.to_id = n.id
        group by n.id`,
      [ids],
    );
    for (const row of res.rows) out.set(row.node_id, Number(row.degree));
    return out;
  }

  /** A bounded slice of the graph edges, lowest id first. For the console map. */
  async listEdges(limit = 500): Promise<Edge[]> {
    const res = await this.pool.query<EdgeRow>(`${EDGE_SELECT} order by id limit $1`, [limit]);
    return res.rows.map(edgeFromRow);
  }

  // --- observability: append-only run trace ---------------------------------

  /** Record one finished operation. written once, never mutated. */
  async recordRun(draft: RunDraft): Promise<RunRecord> {
    const id = `run_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const run = RunRecordSchema.parse({
      id,
      kind: draft.kind,
      status: draft.status,
      ...(draft.label !== undefined ? { label: draft.label } : {}),
      ...(draft.model !== undefined ? { model: draft.model } : {}),
      ...(draft.tokensIn !== undefined ? { tokensIn: draft.tokensIn } : {}),
      ...(draft.tokensOut !== undefined ? { tokensOut: draft.tokensOut } : {}),
      ...(draft.costUsd !== undefined ? { costUsd: draft.costUsd } : {}),
      latencyMs: Math.round(draft.latencyMs),
      ...(draft.inputSummary !== undefined ? { inputSummary: draft.inputSummary } : {}),
      ...(draft.outputSummary !== undefined ? { outputSummary: draft.outputSummary } : {}),
      ...(draft.error !== undefined ? { error: draft.error } : {}),
      ...(draft.parentId !== undefined ? { parentId: draft.parentId } : {}),
      ...(draft.metadata !== undefined ? { metadata: draft.metadata } : {}),
      createdAt,
    });
    await this.pool.query(
      `insert into run
       (id, kind, status, label, model, tokens_in, tokens_out, cost_usd, latency_ms, input_summary, output_summary, error, parent_id, metadata, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)`,
      [
        run.id,
        run.kind,
        run.status,
        run.label ?? null,
        run.model ?? null,
        run.tokensIn ?? null,
        run.tokensOut ?? null,
        run.costUsd ?? null,
        run.latencyMs,
        run.inputSummary ?? null,
        run.outputSummary ?? null,
        run.error ?? null,
        run.parentId ?? null,
        run.metadata ? JSON.stringify(run.metadata) : null,
        run.createdAt,
      ],
    );
    return run;
  }

  async getRun(id: string): Promise<RunRecord | undefined> {
    const res = await this.pool.query<RunRow>(`${RUN_SELECT} where id = $1`, [id]);
    const row = res.rows[0];
    return row ? this.mapRunRow(row) : undefined;
  }

  /** Recent runs, newest first, bounded. Filter by kind, status, and a created
   *  cursor for paging. Never returns the whole table. */
  async listRuns(filter: RunFilter = {}): Promise<RunRecord[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (filter.kind) {
      conditions.push(`kind = $${idx++}`);
      values.push(filter.kind);
    }
    if (filter.status) {
      conditions.push(`status = $${idx++}`);
      values.push(filter.status);
    }
    if (filter.before) {
      conditions.push(`created_at < $${idx++}`);
      values.push(filter.before);
    }
    const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
    const limit = Math.min(filter.limit ?? 100, 1000);
    values.push(limit);
    const res = await this.pool.query<RunRow>(
      `${RUN_SELECT} ${where} order by created_at desc limit $${idx}`,
      values,
    );
    return res.rows.map((row) => this.mapRunRow(row));
  }

  /** Aggregate the run trace into the numbers the dashboard shows: counts,
   *  errors, token totals, cost, latency percentiles, and a per-kind rollup. */
  async runMetrics(filter: { since?: string; until?: string } = {}): Promise<RunMetrics> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (filter.since) {
      conditions.push(`created_at >= $${idx++}`);
      values.push(filter.since);
    }
    if (filter.until) {
      conditions.push(`created_at <= $${idx++}`);
      values.push(filter.until);
    }
    const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";

    const overall = await this.pool.query<{
      count: string;
      error_count: string;
      total_tokens_in: string;
      total_tokens_out: string;
      total_cost_usd: string;
      p50: string;
      p95: string;
    }>(
      `select
         count(*) as count,
         count(*) filter (where status = 'error') as error_count,
         coalesce(sum(tokens_in), 0) as total_tokens_in,
         coalesce(sum(tokens_out), 0) as total_tokens_out,
         coalesce(sum(cost_usd), 0) as total_cost_usd,
         coalesce(percentile_cont(0.5) within group (order by latency_ms), 0) as p50,
         coalesce(percentile_cont(0.95) within group (order by latency_ms), 0) as p95
       from run ${where}`,
      values,
    );

    const byKindRes = await this.pool.query<{
      kind: string;
      count: string;
      error_count: string;
      cost_usd: string;
      avg_latency_ms: string;
    }>(
      `select kind,
         count(*) as count,
         count(*) filter (where status = 'error') as error_count,
         coalesce(sum(cost_usd), 0) as cost_usd,
         coalesce(avg(latency_ms), 0) as avg_latency_ms
       from run ${where}
       group by kind`,
      values,
    );

    const byKind: RunMetrics["byKind"] = {};
    for (const row of byKindRes.rows) {
      byKind[row.kind] = {
        count: Number(row.count),
        errorCount: Number(row.error_count),
        costUsd: Number(row.cost_usd),
        avgLatencyMs: Number(row.avg_latency_ms),
      };
    }

    const o = overall.rows[0];
    return {
      count: Number(o?.count ?? 0),
      errorCount: Number(o?.error_count ?? 0),
      totalTokensIn: Number(o?.total_tokens_in ?? 0),
      totalTokensOut: Number(o?.total_tokens_out ?? 0),
      totalCostUsd: Number(o?.total_cost_usd ?? 0),
      p50LatencyMs: Number(o?.p50 ?? 0),
      p95LatencyMs: Number(o?.p95 ?? 0),
      byKind,
    };
  }

  /** True if any evidence row already has this exact source. connector sync
   *  uses this to skip re-ingesting an item it already captured. A pure read:
   *  It never mutates or constrains evidence (still append only). */
  async hasEvidenceSource(source: string): Promise<boolean> {
    const res = await this.pool.query("select 1 from evidence where source = $1 limit 1", [source]);
    return res.rows.length > 0;
  }

  // --- connector sync state -------------------------------------------------

  /** Record the outcome of one connector sync atomically. The cursor only
   *  advances on success; total_items accumulates; the last error is set on
   *  failure and cleared on success. */
  async recordSyncOutcome(name: string, outcome: SyncOutcome): Promise<ConnectorState> {
    const res = await this.pool.query<ConnectorStateRow>(
      `insert into connector_state
         (name, cursor, last_run_at, last_status, last_error, items_last_run, total_items, enabled, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $6, true, $3, $3)
       on conflict (name) do update set
         cursor = coalesce(excluded.cursor, connector_state.cursor),
         last_run_at = excluded.last_run_at,
         last_status = excluded.last_status,
         last_error = excluded.last_error,
         items_last_run = excluded.items_last_run,
         total_items = connector_state.total_items + excluded.items_last_run,
         updated_at = excluded.updated_at
       returning name, cursor, last_run_at, last_status, last_error, items_last_run, total_items, enabled, updated_at`,
      [
        name,
        outcome.ok ? (outcome.cursor ?? null) : null,
        outcome.ranAt,
        outcome.ok ? "ok" : "error",
        outcome.error ?? null,
        outcome.itemsIngested,
      ],
    );
    return this.mapConnectorStateRow(res.rows[0] as ConnectorStateRow);
  }

  async getConnectorState(name: string): Promise<ConnectorState | undefined> {
    const res = await this.pool.query<ConnectorStateRow>(
      `select name, cursor, last_run_at, last_status, last_error, items_last_run, total_items, enabled, updated_at
       from connector_state where name = $1`,
      [name],
    );
    const row = res.rows[0];
    return row ? this.mapConnectorStateRow(row) : undefined;
  }

  async listConnectorState(): Promise<ConnectorState[]> {
    const res = await this.pool.query<ConnectorStateRow>(
      `select name, cursor, last_run_at, last_status, last_error, items_last_run, total_items, enabled, updated_at
       from connector_state order by name`,
    );
    return res.rows.map((row) => this.mapConnectorStateRow(row));
  }

  // --- connector config -----------------------------------------------------

  /** Insert or update a connector's config. When secretCipher is undefined the
   *  existing secret is preserved, so a settings-only edit never wipes the key. */
  async upsertConnectorConfig(draft: ConnectorConfigDraft): Promise<ConnectorConfigRecord> {
    const now = new Date().toISOString();
    const res = await this.pool.query<ConnectorConfigRow>(
      `insert into connector_config (name, kind, enabled, settings, secret_cipher, created_at, updated_at)
       values ($1, $2, $3, $4::jsonb, $5, $6, $6)
       on conflict (name) do update set
         kind = excluded.kind,
         enabled = excluded.enabled,
         settings = excluded.settings,
         secret_cipher = coalesce(excluded.secret_cipher, connector_config.secret_cipher),
         updated_at = excluded.updated_at
       returning name, kind, enabled, settings, secret_cipher, created_at, updated_at`,
      [
        draft.name,
        draft.kind,
        draft.enabled,
        JSON.stringify(draft.settings),
        draft.secretCipher ?? null,
        now,
      ],
    );
    return this.mapConnectorConfigRow(res.rows[0] as ConnectorConfigRow);
  }

  async setConnectorEnabled(name: string, enabled: boolean): Promise<void> {
    await this.pool.query(
      "update connector_config set enabled = $2, updated_at = $3 where name = $1",
      [name, enabled, new Date().toISOString()],
    );
  }

  /** Public view of a connector config: never exposes the secret, only whether
   *  one is set. */
  async getConnectorConfig(name: string): Promise<ConnectorConfigRecord | undefined> {
    const res = await this.pool.query<ConnectorConfigRow>(
      `select name, kind, enabled, settings, secret_cipher, created_at, updated_at
       from connector_config where name = $1`,
      [name],
    );
    const row = res.rows[0];
    return row ? this.mapConnectorConfigRow(row) : undefined;
  }

  async listConnectorConfigs(): Promise<ConnectorConfigRecord[]> {
    const res = await this.pool.query<ConnectorConfigRow>(
      `select name, kind, enabled, settings, secret_cipher, created_at, updated_at
       from connector_config order by name`,
    );
    return res.rows.map((row) => this.mapConnectorConfigRow(row));
  }

  /** The stored secret ciphertext for a connector, for the sync engine to
   *  decrypt. kept off the public config type on purpose. */
  async getConnectorSecretCipher(name: string): Promise<string | undefined> {
    const res = await this.pool.query<{ secret_cipher: string | null }>(
      "select secret_cipher from connector_config where name = $1",
      [name],
    );
    return res.rows[0]?.secret_cipher ?? undefined;
  }

  async deleteConnectorConfig(name: string): Promise<void> {
    await this.pool.query("delete from connector_config where name = $1", [name]);
  }

  // --- internals ------------------------------------------------------------

  private mapRunRow(row: RunRow): RunRecord {
    return RunRecordSchema.parse({
      id: row.id,
      kind: row.kind,
      status: row.status,
      ...(row.label !== null ? { label: row.label } : {}),
      ...(row.model !== null ? { model: row.model } : {}),
      ...(row.tokens_in !== null ? { tokensIn: row.tokens_in } : {}),
      ...(row.tokens_out !== null ? { tokensOut: row.tokens_out } : {}),
      ...(row.cost_usd !== null ? { costUsd: row.cost_usd } : {}),
      latencyMs: row.latency_ms,
      ...(row.input_summary !== null ? { inputSummary: row.input_summary } : {}),
      ...(row.output_summary !== null ? { outputSummary: row.output_summary } : {}),
      ...(row.error !== null ? { error: row.error } : {}),
      ...(row.parent_id !== null ? { parentId: row.parent_id } : {}),
      ...(row.metadata !== null ? { metadata: row.metadata } : {}),
      createdAt: iso(row.created_at),
    });
  }

  private mapConnectorStateRow(row: ConnectorStateRow): ConnectorState {
    return ConnectorStateSchema.parse({
      name: row.name,
      ...(row.cursor !== null ? { cursor: iso(row.cursor) } : {}),
      ...(row.last_run_at !== null ? { lastRunAt: iso(row.last_run_at) } : {}),
      lastStatus: row.last_status,
      ...(row.last_error !== null ? { lastError: row.last_error } : {}),
      ...(row.items_last_run !== null ? { itemsLastRun: row.items_last_run } : {}),
      totalItems: row.total_items,
      enabled: row.enabled,
      updatedAt: iso(row.updated_at),
    });
  }

  private mapConnectorConfigRow(row: ConnectorConfigRow): ConnectorConfigRecord {
    return ConnectorConfigRecordSchema.parse({
      name: row.name,
      kind: row.kind,
      enabled: row.enabled,
      settings: row.settings,
      hasSecret: row.secret_cipher !== null,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    });
  }

  private distilledCommon(row: DistilledRow): {
    status: Status;
    confidence: Confidence;
    createdAt: string;
    updatedAt: string;
  } {
    return {
      status: row.status as Status,
      confidence: {
        value: row.confidence_value,
        source: row.confidence_source as "model" | "human",
      },
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }

  private async getProvenance(nodeId: string): Promise<Provenance> {
    const res = await this.pool.query<{
      evidence_id: string;
      span_start: number;
      span_end: number;
    }>("select evidence_id, span_start, span_end from provenance where node_id = $1 order by id", [
      nodeId,
    ]);
    return res.rows.map((row) => ({
      evidenceId: row.evidence_id,
      start: row.span_start,
      end: row.span_end,
    }));
  }

  private async insertProvenance(
    client: pg.PoolClient,
    nodeId: string,
    nodeKind: DistilledKind,
    provenance: Provenance,
  ): Promise<void> {
    for (const span of provenance) {
      // idempotent: the same (node, evidence, span) link is inserted at most
      // once (unique index in 0002), so a retry or a re-promote never duplicates
      // provenance. evidence itself is untouched; this is the link table.
      await client.query(
        `insert into provenance (node_id, node_kind, evidence_id, span_start, span_end)
         values ($1, $2, $3, $4, $5)
         on conflict (node_id, node_kind, evidence_id, span_start, span_end) do nothing`,
        [nodeId, nodeKind, span.evidenceId, span.start, span.end],
      );
    }
  }

  /**
   * Run fn while holding a session advisory lock scoped to one connector, so two
   * syncs of the same connector cannot run at once and race the check-then-insert
   * dedup into duplicate immutable evidence. The lock is advisory and
   * cooperative: only the sync path takes it, so it never blocks manual ingest or
   * any other writer. It is released even if fn throws, and a different connector
   * name takes a different lock so connectors never block each other.
   */
  async withConnectorLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      // two int4 keys: a fixed namespace for connector sync + a hash of the name,
      // so this lock space cannot collide with any other advisory lock usage.
      await client.query("select pg_advisory_lock($1, hashtext($2))", [CONNECTOR_LOCK_NS, name]);
      return await fn();
    } finally {
      try {
        await client.query("select pg_advisory_unlock($1, hashtext($2))", [
          CONNECTOR_LOCK_NS,
          name,
        ]);
      } finally {
        client.release();
      }
    }
  }

  private async tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }
}

/** Build a Store from DATABASE_URL. Fails loud if it is missing. */
export function createStore(databaseUrl: string | undefined = process.env.DATABASE_URL): Store {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set. Point it at your Postgres and retry.");
  }
  return new Store(databaseUrl);
}
