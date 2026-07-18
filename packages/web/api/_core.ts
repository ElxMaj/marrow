// Shared core for the hosted demo's serverless functions. The leading
// underscore keeps Vercel from treating this as a route. A single Marrow and
// Store (sharing one pg pool) is created at module scope so warm invocations
// reuse the connection instead of opening a new one per request. The console
// endpoints (runs, metrics, connectors, evidence) read and write through the
// Store; no model or embedding provider is wired here.
import { Marrow, Store } from "@marrowhq/core";

let store: Store | undefined;
let core: Marrow | undefined;

export function getStore(): Store {
  if (!store) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    store = new Store(url);
  }
  return store;
}

export function getCore(): Marrow {
  if (!core) core = new Marrow(getStore());
  return core;
}

export async function closeServerlessForTests(): Promise<void> {
  await store?.close();
  store = undefined;
  core = undefined;
}

/** A hosted public demo sets MARROW_READ_ONLY=1 so the promote-to-decided
 *  path and the connector/ingest writes are refused. */
export const READ_ONLY = process.env.MARROW_READ_ONLY === "1";

export function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

/** A client-caused failure with its own HTTP status, classified by `route` so a
 *  serverless function answers 4xx with a clean message instead of a raw 500.
 *  Mirrors ApiError in src/api.ts (the Node server); kept in step with it. */
export class ApiError extends Error {
  readonly status: number;
  readonly allow?: string[];
  constructor(status: number, message: string, allow?: string[]) {
    super(message);
    this.status = status;
    if (allow !== undefined) this.allow = allow;
  }
}

const MAX_BODY_BYTES = 1_000_000; // 1 MB cap; answers are short, not uploads.

export async function readJson(
  req: import("node:http").IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new ApiError(413, "request body too large (1MB cap)");
    chunks.push(Buffer.from(chunk as Buffer));
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "request body is not valid JSON");
  }
}

/** Map any thrown value to an HTTP response. An ApiError carries its own status;
 *  core speaks a consistent voice ("x not found" = a missing id, "y is required"
 *  or "invalid z" = a bad payload); everything else is an internal 500 whose
 *  detail never reaches the client. Mirrors the classifier in src/api.ts. */
export function classifyError(error: unknown): {
  status: number;
  message: string;
  allow?: string[];
  isInternal: boolean;
} {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      message: error.message,
      ...(error.allow ? { allow: error.allow } : {}),
      isInternal: false,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/not found/i.test(message)) return { status: 404, message, isInternal: false };
  if (/is required|invalid /i.test(message)) return { status: 400, message, isInternal: false };
  return { status: 500, message: "internal error; see the server log", isInternal: true };
}

type Handler = (
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
) => Promise<void>;

/** Wrap a serverless handler so a thrown ApiError or a core "not found" answers
 *  a typed 4xx, and anything unclassified logs server-side and answers a generic
 *  500 that leaks no internals. Without this, Vercel turns every throw into a
 *  raw 500 (an unknown trace id, an oversized body, malformed JSON). */
export function route(handler: Handler): Handler {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const { status, message, allow, isInternal } = classifyError(error);
      if (isInternal) console.error("serverless: unhandled error:", error);
      if (allow) res.setHeader("allow", allow.join(", "));
      sendJson(res, status, { error: message });
    }
  };
}

const PREVIEW = 280;

/** Merge connector_config with connector_state into one row per connector. The
 *  same shape src/api.ts getConnectors produces, kept in step with it. */
export async function connectorViews(s: Store): Promise<unknown[]> {
  const [configs, states] = await Promise.all([s.listConnectorConfigs(), s.listConnectorState()]);
  const byName = new Map(states.map((st) => [st.name, st]));
  const seen = new Set<string>();
  const views: Record<string, unknown>[] = [];
  for (const c of configs) {
    seen.add(c.name);
    const st = byName.get(c.name);
    views.push({
      name: c.name,
      kind: c.kind,
      enabled: c.enabled,
      settings: c.settings,
      hasSecret: c.hasSecret,
      lastStatus: st?.lastStatus ?? "never",
      ...(st?.lastRunAt ? { lastRunAt: st.lastRunAt } : {}),
      ...(st?.lastError ? { lastError: st.lastError } : {}),
      ...(st?.itemsLastRun !== undefined ? { itemsLastRun: st.itemsLastRun } : {}),
      totalItems: st?.totalItems ?? 0,
      createdAt: c.createdAt,
      updatedAt: st?.updatedAt ?? c.updatedAt,
    });
  }
  for (const st of states) {
    if (seen.has(st.name)) continue;
    views.push({
      name: st.name,
      kind: st.name,
      enabled: st.enabled,
      settings: {},
      hasSecret: false,
      lastStatus: st.lastStatus,
      ...(st.lastRunAt ? { lastRunAt: st.lastRunAt } : {}),
      ...(st.lastError ? { lastError: st.lastError } : {}),
      ...(st.itemsLastRun !== undefined ? { itemsLastRun: st.itemsLastRun } : {}),
      totalItems: st.totalItems,
      updatedAt: st.updatedAt,
    });
  }
  return views.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** Goals for the Goals space, each with its served-entity name resolved for
 *  display. The same shape src/api.ts getGoals produces, kept in step with it: a
 *  read-only window onto the goal nodes, no distillation here. */
export async function goalViews(
  s: Store,
  filter: { status?: string; goalType?: "product" | "user"; entityId?: string } = {},
): Promise<unknown[]> {
  const goals = await s.listGoals(filter as Parameters<Store["listGoals"]>[0]);
  const views: Record<string, unknown>[] = [];
  for (const g of goals) {
    let entityName: string | undefined;
    if (g.entityId) {
      const node = await s.getNode(g.entityId);
      if (node && node.kind === "entity") entityName = node.name;
    }
    views.push(entityName ? { ...g, entityName } : { ...g });
  }
  return views;
}

export function evidenceLite(e: { id: string; source: string; createdAt: string; text: string }) {
  return {
    id: e.id,
    source: e.source,
    createdAt: e.createdAt,
    preview: e.text.slice(0, PREVIEW),
    chars: e.text.length,
  };
}
