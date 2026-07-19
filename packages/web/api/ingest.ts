import type { IncomingMessage, ServerResponse } from "node:http";

import { READ_ONLY, evidenceLite, getStore, readJson, route, sendJson } from "./_core.js";

// POST /api/ingest { text, source } — drop raw text into the brain as immutable
// evidence. append only: this only ever inserts, never edits. distillation runs
// later through the normal pipeline. refused in a read-only demo.
async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
  if (READ_ONLY)
    return sendJson(res, 403, { error: "this is a read-only demo; writes are disabled" });
  const body = await readJson(req);
  const text = body.text;
  const source = body.source as string | undefined;
  if (typeof text !== "string" || !text.trim() || !source) {
    return sendJson(res, 400, { error: "text and source are required" });
  }
  const evidence = await getStore().insertEvidence({ text, source });
  sendJson(res, 200, evidenceLite(evidence));
}

export default route(handler);
