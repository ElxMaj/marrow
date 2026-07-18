import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join, normalize } from "node:path";

import {
  type BrainGraph,
  encryptSecret,
  type Marrow,
  Store,
  SyncEngine,
  type TraceResult,
} from "@marrowhq/core";
import {
  type ConnectorConfigRecord,
  type ConnectorSyncResult,
  type Decision,
  type Entity,
  type Evidence,
  type Goal,
  type Question,
  type RunKind,
  type RunMetrics,
  type RunRecord,
  type RunStatus,
  type Status,
} from "@marrowhq/shared";

// Local type for catch API response (mirrors ui.CatchView but server-side)
interface CatchView {
  id: string;
  status: "open" | "acted-on" | "dismissed";
  decisionId: string;
  decisionTitle: string;
  decisionSourceLabel: string;
  path: string | undefined;
  lineStart: number | undefined;
  lineEnd: number | undefined;
  hunkText: string;
  verdict: "warn" | "contradiction";
  confidence: number;
  modelUsed: string | undefined;
  surfacedAt: string;
  trigger: string;
}

// The web is a thin window onto core. These handlers only call core; no
// ingestion, distillation, merge or promote logic lives here. Answering goes
// through core.answer, the exact same promote path the CLI uses. The console
// surfaces (observability, connectors, ingest) read and write the run trace and
// connector tables through a Store, but they are still pure passthroughs: every
// handler is one core call, no product logic leaks into the web.

export interface BrainState {
  decisions: Decision[];
  entities: Entity[];
  questions: Question[];
  graph: BrainGraph;
  readOnly: boolean;
}

/** One connector, its stored config merged with its live sync state. The shape
 *  the Connectors view renders: a card per configured connector. */
export interface ConnectorView {
  name: string;
  kind: string;
  enabled: boolean;
  settings: Record<string, unknown>;
  hasSecret: boolean;
  lastStatus: "ok" | "error" | "never";
  lastRunAt?: string;
  lastError?: string;
  itemsLastRun?: number;
  totalItems: number;
  createdAt?: string;
  updatedAt: string;
}

/** A recent evidence row, trimmed for the Ingest view: the raw substrate is
 *  append only, so this is a read window, never an edit surface. */
export interface EvidenceLite {
  id: string;
  source: string;
  createdAt: string;
  preview: string;
  chars: number;
}

const EVIDENCE_PREVIEW_CHARS = 280;

function evidenceLite(e: Evidence): EvidenceLite {
  return {
    id: e.id,
    source: e.source,
    createdAt: e.createdAt,
    preview: e.text.slice(0, EVIDENCE_PREVIEW_CHARS),
    chars: e.text.length,
  };
}

/** Merge connector_config with connector_state into one row per connector. a
 *  config with no state yet reads as "never" synced; a state with no config
 *  (built from env, not stored) still shows so its health is visible. */
export async function getConnectors(store: Store): Promise<ConnectorView[]> {
  const [configs, states] = await Promise.all([
    store.listConnectorConfigs(),
    store.listConnectorState(),
  ]);
  const stateByName = new Map(states.map((s) => [s.name, s]));
  const seen = new Set<string>();
  const views: ConnectorView[] = [];
  for (const c of configs) {
    seen.add(c.name);
    const s = stateByName.get(c.name);
    views.push({
      name: c.name,
      kind: c.kind,
      enabled: c.enabled,
      settings: c.settings,
      hasSecret: c.hasSecret,
      lastStatus: s?.lastStatus ?? "never",
      ...(s?.lastRunAt ? { lastRunAt: s.lastRunAt } : {}),
      ...(s?.lastError ? { lastError: s.lastError } : {}),
      ...(s?.itemsLastRun !== undefined ? { itemsLastRun: s.itemsLastRun } : {}),
      totalItems: s?.totalItems ?? 0,
      createdAt: c.createdAt,
      updatedAt: s?.updatedAt ?? c.updatedAt,
    });
  }
  for (const s of states) {
    if (seen.has(s.name)) continue;
    views.push({
      name: s.name,
      kind: s.name,
      enabled: s.enabled,
      settings: {},
      hasSecret: false,
      lastStatus: s.lastStatus,
      ...(s.lastRunAt ? { lastRunAt: s.lastRunAt } : {}),
      ...(s.lastError ? { lastError: s.lastError } : {}),
      ...(s.itemsLastRun !== undefined ? { itemsLastRun: s.itemsLastRun } : {}),
      totalItems: s.totalItems,
      updatedAt: s.updatedAt,
    });
  }
  return views.sort((a, b) => a.name.localeCompare(b.name));
}

export async function recentEvidence(store: Store, limit = 30): Promise<EvidenceLite[]> {
  // searchEvidence("") matches every row (ilike '%%'), newest first, bounded.
  const rows = await store.searchEvidence("", limit);
  return rows.map(evidenceLite);
}

/** Upsert a connector config, encrypting the secret at rest before it touches
 *  the database. An absent secret keeps any existing one. */
export async function upsertConnector(
  store: Store,
  input: {
    name: string;
    kind: string;
    enabled: boolean;
    settings: Record<string, unknown>;
    secret?: string;
  },
  secretKey?: string,
): Promise<ConnectorConfigRecord> {
  const secretCipher =
    input.secret && input.secret.length > 0
      ? encryptSecret(input.secret, secretKey ?? process.env.MARROW_SECRET_KEY)
      : undefined;
  return store.upsertConnectorConfig({
    name: input.name,
    kind: input.kind,
    enabled: input.enabled,
    settings: input.settings,
    ...(secretCipher ? { secretCipher } : {}),
  });
}

/** A hosted public demo sets MARROW_READ_ONLY=1 so the privileged
 *  promote-to-decided path (/api/answer) is refused and the UI can say so.
 *  The default (unset) keeps the local single-user tool fully writable. */
export function isReadOnly(): boolean {
  return process.env.MARROW_READ_ONLY === "1";
}

/** One catch row for the Catches view, shaped server-side from events plus
 *  status. Shared by the /api/catches handler and the static demo export so the
 *  two never drift. */
export interface CatchListItem {
  id: string;
  status: CatchView["status"];
  decisionId: string;
  decisionTitle: string;
  decisionSourceLabel: string;
  path: string | undefined;
  lineStart: number | undefined;
  lineEnd: number | undefined;
  hunkText: string;
  verdict: "warn" | "contradiction";
  confidence: number;
  modelUsed: string | undefined;
  surfacedAt: string;
  trigger: string;
}

export async function getCatches(store: Store): Promise<CatchListItem[]> {
  const events = await store.listCatchEvents({ eventType: "catch_surfaced" });
  const views: CatchListItem[] = [];
  for (const event of events) {
    if (!event.question_id || !event.decision_id) continue;
    const question = await store.getQuestion(event.question_id);
    const decision = await store.getNode(event.decision_id);
    if (!question || !decision || decision.kind !== "decision") continue;

    // derive status from question state. A catch answered through the normal
    // Questions loop is resolved as superseded, but it is no longer
    // actionable; treat it the same as an accepted catch.
    let status: CatchView["status"] = "open";
    if (question.status === "decided" || question.status === "superseded") status = "acted-on";
    else if (question.status === "dismissed") status = "dismissed";

    const sourceLabel = `${decision.provenance.length} evidence span${
      decision.provenance.length === 1 ? "" : "s"
    }`;

    views.push({
      id: question.id,
      status,
      decisionId: decision.id,
      decisionTitle: decision.title,
      decisionSourceLabel: sourceLabel,
      path: event.diff_span?.path,
      lineStart: event.diff_span?.lineStart,
      lineEnd: event.diff_span?.lineEnd,
      hunkText: event.diff_span?.hunkText ?? "",
      verdict: (event.confidence ?? 0) >= 0.65 ? "contradiction" : "warn",
      confidence: event.confidence ?? 0,
      modelUsed: event.model_used ?? undefined,
      surfacedAt: event.created_at,
      trigger: event.trigger,
    });
  }
  views.sort((a, b) => b.surfacedAt.localeCompare(a.surfacedAt));
  return views;
}

/** Catch precision + dismiss-rate for the Catches header. Excludes synthetic
 *  events so the demo never reports padded numbers. */
export async function getCatchMetricsView(store: Store): Promise<{
  surfaced: number;
  actedOn: number;
  dismissed: number;
  precision: number;
  dismissRate: number;
}> {
  const metrics = await store.getCatchMetrics({ excludeSynthetic: true });
  return {
    surfaced: metrics.surfaced,
    actedOn: metrics.actedOn,
    dismissed: metrics.dismissed,
    precision: metrics.precision ?? 0,
    dismissRate: metrics.dismissRate ?? 0,
  };
}

/** Read goals for the Goals space. A thin window: lists through the Store (like
 *  catches and runs) and resolves each goal's served-entity name for display. It
 *  never writes and never distills. */
export async function getGoals(
  store: Store,
  filter: { status?: Status; goalType?: "product" | "user"; entityId?: string } = {},
): Promise<(Goal & { entityName?: string })[]> {
  const goals = await store.listGoals(filter);
  const out: (Goal & { entityName?: string })[] = [];
  for (const g of goals) {
    let entityName: string | undefined;
    if (g.entityId) {
      const node = await store.getNode(g.entityId);
      if (node && node.kind === "entity") entityName = node.name;
    }
    out.push(entityName ? { ...g, entityName } : { ...g });
  }
  return out;
}

/** Author a goal. A HUMAN action, so core lands it decided with a human
 *  confidence and captures the authored text as immutable evidence. This drives
 *  core.authorGoal, the same path the CLI uses; the web owns no promote logic. */
export async function authorGoal(
  core: Marrow,
  input: { title: string; description?: string; goalType: "product" | "user"; entityId?: string },
): Promise<Goal> {
  return core.authorGoal(input);
}

export async function getState(core: Marrow): Promise<BrainState> {
  const [decisions, entities, questions, graph] = await Promise.all([
    core.getDecisions(),
    core.listEntities(),
    core.getOpenQuestions(),
    core.getGraph(),
  ]);
  return { decisions, entities, questions, graph, readOnly: isReadOnly() };
}

export async function trace(core: Marrow, nodeId: string): Promise<TraceResult> {
  return core.traceToSource(nodeId);
}

export async function answerQuestion(
  core: Marrow,
  questionId: string,
  text: string,
  decide?: string,
): Promise<{ promoted: unknown[]; superseded: unknown[] }> {
  // `decide` names which related decision holds when a conflict question relates
  // to more than one; core promotes only that one and never both sides.
  return core.answer(questionId, text, decide !== undefined ? { decide } : {});
}

export async function answerBatch(
  core: Marrow,
  answers: { questionId: string; text: string; decide?: string }[],
): Promise<{ promoted: unknown[]; superseded: unknown[] }> {
  return core.answerBatch(answers);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(json);
}

const MAX_BODY_BYTES = 1_000_000; // 1 MB cap; answers are short, not uploads.

/** A client-caused failure with its own HTTP status. Thrown anywhere under
 *  handle(), classified by the top-level catch: the API answers 4xx with a
 *  clean message instead of translating every mistake into a 500. */
export class ApiError extends Error {
  readonly status: number;
  readonly allow?: string[];
  constructor(status: number, message: string, allow?: string[]) {
    super(message);
    this.status = status;
    if (allow !== undefined) this.allow = allow;
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ApiError(413, "request body too large (1MB cap)");
    chunks.push(Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ApiError(400, "request body is not valid JSON");
  }
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

export interface ApiServerOptions {
  /** directory of built frontend assets to serve for non-API routes (prod). */
  clientDir?: string;
  /** the Store the console endpoints read and write directly. defaults to one
   *  built from DATABASE_URL, mirroring the serverless functions in api/. */
  store?: Store;
  /** key for encrypting connector secrets and decrypting them at sync time.
   *  defaults to MARROW_SECRET_KEY. */
  secretKey?: string;
}

/** Lazily build the Store the console endpoints need, once per server. */
function resolveStore(options: ApiServerOptions): Store | undefined {
  if (options.store) return options.store;
  const url = process.env.DATABASE_URL;
  return url ? new Store(url) : undefined;
}

interface Resolved {
  store: Store | undefined;
  secretKey: string | undefined;
}

/** A thin HTTP server: /api/* maps to core, everything else serves the SPA. */
export function createApiServer(core: Marrow, options: ApiServerOptions = {}): Server {
  const resolved: Resolved = {
    store: resolveStore(options),
    secretKey: options.secretKey ?? process.env.MARROW_SECRET_KEY,
  };
  return createServer((req, res) => {
    void handle(core, req, res, options, resolved).catch((error: unknown) => {
      // classify: a client mistake answers 4xx with a clean message; anything
      // else logs server-side and answers a generic 500, never leaking
      // internals into the response body.
      if (error instanceof ApiError) {
        if (error.allow !== undefined) res.setHeader("allow", error.allow.join(", "));
        return send(res, error.status, { error: error.message });
      }
      const message = error instanceof Error ? error.message : String(error);
      // core speaks in a consistent voice: "x not found" is the caller naming
      // a missing id, "y is required / invalid z" is a bad payload.
      if (/not found/i.test(message)) return send(res, 404, { error: message });
      if (/is required|invalid /i.test(message)) return send(res, 400, { error: message });
      console.error("api: unhandled error:", error);
      return send(res, 500, { error: "internal error; see the server log" });
    });
  });
}

function requireStore(store: Store | undefined): Store {
  if (!store) throw new ApiError(500, "DATABASE_URL is not set on the server");
  return store;
}

/** Every API route and its allowed methods: exact paths and id-carrying
 *  prefixes. The dispatch chain below matches path+method together; this table
 *  exists so a known path with the wrong verb answers 405 with Allow instead
 *  of pretending the route does not exist. */
const API_ROUTES: { path: string; exact: boolean; methods: string[] }[] = [
  { path: "/api/state", exact: true, methods: ["GET"] },
  { path: "/api/metrics", exact: true, methods: ["GET"] },
  { path: "/api/runs", exact: true, methods: ["GET"] },
  { path: "/api/connectors", exact: true, methods: ["GET", "POST"] },
  { path: "/api/goals", exact: true, methods: ["GET", "POST"] },
  { path: "/api/catches", exact: true, methods: ["GET"] },
  { path: "/api/catches/metrics", exact: true, methods: ["GET"] },
  { path: "/api/ingest", exact: true, methods: ["POST"] },
  { path: "/api/answer", exact: true, methods: ["POST"] },
  { path: "/api/answer-batch", exact: true, methods: ["POST"] },
  { path: "/api/trace/", exact: false, methods: ["GET"] },
  { path: "/api/runs/", exact: false, methods: ["GET"] },
  { path: "/api/catches/", exact: false, methods: ["POST"] },
  { path: "/api/connectors/", exact: false, methods: ["POST"] },
];

async function handle(
  core: Marrow,
  req: IncomingMessage,
  res: ServerResponse,
  options: ApiServerOptions,
  resolved: Resolved,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  // a trailing slash on an API route is the same route: /api/state/ works.
  let path = url.pathname;
  if (path.startsWith("/api/") && path.length > 5 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }

  // HEAD answers exactly like GET with the body suppressed, so health checks
  // and monitors that probe with HEAD read the endpoint as up.
  if (req.method === "HEAD") {
    req.method = "GET";
    const realEnd = res.end.bind(res);
    res.write = () => true;
    // node's end() overloads collapse to "drop any body, keep the status".
    res.end = (() => realEnd()) as typeof res.end;
  }

  if (path === "/api/state" && req.method === "GET") {
    return send(res, 200, await getState(core));
  }
  if (path.startsWith("/api/trace/") && req.method === "GET") {
    const nodeId = decodeURIComponent(path.slice("/api/trace/".length));
    return send(res, 200, await trace(core, nodeId));
  }

  // --- observability: the run trace ----------------------------------------
  if (path === "/api/metrics" && req.method === "GET") {
    const store = requireStore(resolved.store);
    const since = url.searchParams.get("since") ?? undefined;
    const until = url.searchParams.get("until") ?? undefined;
    const metrics: RunMetrics = await store.runMetrics({
      ...(since ? { since } : {}),
      ...(until ? { until } : {}),
    });
    return send(res, 200, metrics);
  }
  if (path === "/api/runs" && req.method === "GET") {
    const store = requireStore(resolved.store);
    const kind = url.searchParams.get("kind") as RunKind | null;
    const status = url.searchParams.get("status") as RunStatus | null;
    const limitRaw = url.searchParams.get("limit");
    const before = url.searchParams.get("before");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    const runs: RunRecord[] = await store.listRuns({
      ...(kind ? { kind } : {}),
      ...(status ? { status } : {}),
      ...(before ? { before } : {}),
      ...(limit !== undefined && Number.isInteger(limit) && limit > 0 ? { limit } : {}),
    });
    return send(res, 200, runs);
  }
  if (path.startsWith("/api/runs/") && req.method === "GET") {
    const store = requireStore(resolved.store);
    const id = decodeURIComponent(path.slice("/api/runs/".length));
    const run = await store.getRun(id);
    if (!run) return send(res, 404, { error: "run not found" });
    return send(res, 200, run);
  }

  // --- connectors: config + live sync state --------------------------------
  if (path === "/api/connectors" && req.method === "GET") {
    return send(res, 200, await getConnectors(requireStore(resolved.store)));
  }
  if (path === "/api/connectors" && req.method === "POST") {
    if (isReadOnly()) {
      return send(res, 403, { error: "this is a read-only demo; writes are disabled" });
    }
    const store = requireStore(resolved.store);
    const body = (await readBody(req)) as {
      name?: string;
      kind?: string;
      enabled?: boolean;
      settings?: Record<string, unknown>;
      secret?: string;
    };
    if (!body.name || !body.kind) {
      return send(res, 400, { error: "name and kind are required" });
    }
    const record = await upsertConnector(
      store,
      {
        name: body.name,
        kind: body.kind,
        enabled: body.enabled ?? true,
        settings: body.settings ?? {},
        ...(body.secret ? { secret: body.secret } : {}),
      },
      resolved.secretKey,
    );
    return send(res, 200, record);
  }
  if (path.startsWith("/api/connectors/") && req.method === "POST") {
    if (isReadOnly()) {
      return send(res, 403, { error: "this is a read-only demo; writes are disabled" });
    }
    const store = requireStore(resolved.store);
    const rest = path.slice("/api/connectors/".length);
    const slash = rest.lastIndexOf("/");
    const name = decodeURIComponent(rest.slice(0, slash));
    const action = rest.slice(slash + 1);
    if (action === "enable") {
      const body = (await readBody(req)) as { enabled?: boolean };
      await store.setConnectorEnabled(name, body.enabled ?? true);
      return send(res, 200, { name, enabled: body.enabled ?? true });
    }
    if (action === "sync") {
      const cfg = await store.getConnectorConfig(name);
      if (!cfg) return send(res, 404, { error: `connector "${name}" is not configured` });
      const engine = new SyncEngine({
        store,
        ...(resolved.secretKey ? { secretKey: resolved.secretKey } : {}),
      });
      const result: ConnectorSyncResult = await engine.runConnector(name);
      return send(res, 200, result);
    }
    return send(res, 404, { error: "not found" });
  }

  // --- ingest: drop raw text into the brain as immutable evidence ----------
  if (path === "/api/evidence/recent" && req.method === "GET") {
    const store = requireStore(resolved.store);
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    return send(
      res,
      200,
      await recentEvidence(
        store,
        limit !== undefined && Number.isInteger(limit) && limit > 0 ? limit : 30,
      ),
    );
  }
  if (path === "/api/ingest" && req.method === "POST") {
    if (isReadOnly()) {
      return send(res, 403, { error: "this is a read-only demo; writes are disabled" });
    }
    const store = requireStore(resolved.store);
    const body = (await readBody(req)) as { text?: string; source?: string };
    if (typeof body.text !== "string" || !body.text.trim() || !body.source) {
      return send(res, 400, { error: "text and source are required" });
    }
    const evidence = await store.insertEvidence({ text: body.text, source: body.source });
    // tell the console what happens next: with a model configured the evidence
    // can become facts; keyless it stays raw until distilled. the UI turns
    // canDistill into the exact next command instead of leaving the user to
    // wonder why no questions appeared.
    return send(res, 200, { ...evidenceLite(evidence), canDistill: core.canDistill });
  }
  if (path === "/api/answer" && req.method === "POST") {
    if (isReadOnly()) {
      return send(res, 403, { error: "this is a read-only demo; answering is disabled" });
    }
    const body = (await readBody(req)) as { questionId?: string; text?: string; decide?: string };
    if (!body.questionId || typeof body.text !== "string") {
      return send(res, 400, { error: "questionId and text are required" });
    }
    return send(res, 200, await answerQuestion(core, body.questionId, body.text, body.decide));
  }
  if (path === "/api/answer-batch" && req.method === "POST") {
    if (isReadOnly()) {
      return send(res, 403, { error: "this is a read-only demo; answering is disabled" });
    }
    const body = (await readBody(req)) as { answers?: unknown[] };
    const answers: { questionId: string; text: string; decide?: string }[] = [];
    if (!Array.isArray(body.answers)) {
      return send(res, 400, { error: "Answers must be an array of { questionId, text, decide? }" });
    }
    for (const entry of body.answers) {
      if (
        entry &&
        typeof entry === "object" &&
        "questionId" in entry &&
        typeof entry.questionId === "string" &&
        "text" in entry &&
        typeof entry.text === "string" &&
        (!("decide" in entry) || typeof (entry as { decide?: unknown }).decide === "string")
      ) {
        const decide = (entry as { decide?: string }).decide;
        answers.push({
          questionId: entry.questionId,
          text: entry.text,
          ...(decide !== undefined ? { decide } : {}),
        });
      } else {
        return send(res, 400, {
          error: "Answers must be an array of { questionId, text, decide? }",
        });
      }
    }
    return send(res, 200, await answerBatch(core, answers));
  }

  // --- catches: drift detection receipts ------------------------------------
  if (path === "/api/catches" && req.method === "GET") {
    const store = requireStore(resolved.store);
    return send(res, 200, await getCatches(store));
  }
  if (path === "/api/catches/metrics" && req.method === "GET") {
    const store = requireStore(resolved.store);
    return send(res, 200, await getCatchMetricsView(store));
  }
  if (path.startsWith("/api/catches/") && req.method === "POST") {
    if (isReadOnly()) {
      return send(res, 403, { error: "this is a read-only demo; writes are disabled" });
    }
    requireStore(resolved.store);
    const rest = path.slice("/api/catches/".length);
    const slash = rest.lastIndexOf("/");
    const questionId = decodeURIComponent(rest.slice(0, slash));
    const action = rest.slice(slash + 1);
    if (action === "accept") {
      const body = (await readBody(req)) as { resolution?: string };
      if (!body.resolution || typeof body.resolution !== "string") {
        return send(res, 400, { error: "resolution is required" });
      }
      await core.acceptCatch(questionId, body.resolution);
      return send(res, 200, { ok: true });
    }
    if (action === "dismiss") {
      const body = (await readBody(req)) as { reason?: string };
      if (!body.reason || typeof body.reason !== "string") {
        return send(res, 400, { error: "reason is required" });
      }
      await core.dismissCatch(questionId, body.reason);
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "not found" });
  }

  // --- goals: the product team's targets, decided vs open -------------------
  if (path === "/api/goals" && req.method === "GET") {
    const store = requireStore(resolved.store);
    const status = url.searchParams.get("status") as Status | null;
    const goalType = url.searchParams.get("goalType");
    return send(
      res,
      200,
      await getGoals(store, {
        ...(status ? { status } : {}),
        ...(goalType === "product" || goalType === "user" ? { goalType } : {}),
      }),
    );
  }
  if (path === "/api/goals" && req.method === "POST") {
    if (isReadOnly()) {
      return send(res, 403, { error: "this is a read-only demo; writes are disabled" });
    }
    const body = (await readBody(req)) as {
      title?: string;
      description?: string;
      goalType?: string;
      entityId?: string;
    };
    if (
      typeof body.title !== "string" ||
      !body.title.trim() ||
      (body.goalType !== "product" && body.goalType !== "user")
    ) {
      return send(res, 400, { error: "title and goalType (product|user) are required" });
    }
    const goal = await authorGoal(core, {
      title: body.title,
      ...(body.description ? { description: body.description } : {}),
      goalType: body.goalType,
      ...(body.entityId ? { entityId: body.entityId } : {}),
    });
    return send(res, 200, goal);
  }

  // Anything still here under /api/ is either a known route with the wrong
  // verb (405 with Allow says which verbs exist) or genuinely unknown (404).
  if (path.startsWith("/api/")) {
    const route = API_ROUTES.find((r) =>
      r.exact ? r.path === path : path.startsWith(r.path) && path.length > r.path.length,
    );
    if (route && !route.methods.includes(req.method ?? "")) {
      throw new ApiError(
        405,
        `method ${req.method} is not allowed here; use ${route.methods.join(" or ")}`,
        route.methods,
      );
    }
    return send(res, 404, { error: "not found" });
  }

  // Static frontend (prod). The dev server (vite) handles this in development.
  if (options.clientDir) {
    const rel = path === "/" ? "index.html" : path.replace(/^\/+/, "");
    const safe = normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
    const file = join(options.clientDir, safe);
    try {
      const data = await readFile(file);
      const ext = safe.slice(safe.lastIndexOf("."));
      res.writeHead(200, { "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream" });
      res.end(data);
      return;
    } catch {
      // SPA fallback: serve index.html for client routes.
      const html = await readFile(join(options.clientDir, "index.html"));
      res.writeHead(200, { "content-type": CONTENT_TYPES[".html"] });
      res.end(html);
      return;
    }
  }
  send(res, 404, { error: "not found" });
}
