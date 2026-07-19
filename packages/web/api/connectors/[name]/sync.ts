import type { IncomingMessage, ServerResponse } from "node:http";

import { SyncEngine } from "@marrowhq/core";

import { READ_ONLY, getStore, route, sendJson } from "../../_core.js";

// POST /api/connectors/:name/sync — run one connector now: pull since its
// cursor, dedup, ingest new items as evidence, advance the cursor, record a
// connector_sync run. the whole automatic-flow story, on demand. the engine
// catches fetch errors and returns an error result, so a bad token is a visible
// outcome, not a crash.
async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
  if (READ_ONLY)
    return sendJson(res, 403, { error: "this is a read-only demo; writes are disabled" });
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const segments = path.split("/").filter(Boolean); // api, connectors, :name, sync
  const name = decodeURIComponent(segments[segments.length - 2] ?? "");
  const store = getStore();
  const cfg = await store.getConnectorConfig(name);
  if (!cfg) return sendJson(res, 404, { error: `connector "${name}" is not configured` });
  const result = await new SyncEngine({ store }).runConnector(name);
  sendJson(res, 200, result);
}

export default route(handler);
