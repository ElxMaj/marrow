import type { IncomingMessage, ServerResponse } from "node:http";

import { getCore, sendJson } from "../_core.js";

// GET /api/trace/:nodeId — the exact evidence span behind a node. the id is the
// last path segment; we read it from the url so the function needs no
// framework-specific request shape.
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const nodeId = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
  if (!nodeId) return sendJson(res, 400, { error: "nodeId required" });
  sendJson(res, 200, await getCore().traceToSource(nodeId));
}
