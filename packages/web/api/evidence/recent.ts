import type { IncomingMessage, ServerResponse } from "node:http";

import { evidenceLite, getStore, sendJson } from "../_core.js";

// GET /api/evidence/recent?limit= — the most recently captured raw evidence,
// newest first. a read window onto the append-only substrate; never an edit
// surface. the Ingest view shows it as "recently captured".
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
  const url = new URL(req.url ?? "/", "http://localhost");
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 30;
  const rows = await getStore().searchEvidence("", Number.isFinite(limit) ? limit : 30);
  sendJson(res, 200, rows.map(evidenceLite));
}
