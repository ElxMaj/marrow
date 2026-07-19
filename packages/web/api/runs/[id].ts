import type { IncomingMessage, ServerResponse } from "node:http";

import { getStore, route, sendJson } from "../_core.js";

// GET /api/runs/:id — one run, the full record for the detail drawer. the id is
// the last path segment, read from the url so the function needs no
// framework-specific request shape.
async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const id = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
  if (!id) return sendJson(res, 400, { error: "run id required" });
  const run = await getStore().getRun(id);
  if (!run) return sendJson(res, 404, { error: "run not found" });
  sendJson(res, 200, run);
}

export default route(handler);
