import type { IncomingMessage, ServerResponse } from "node:http";

import { READ_ONLY, getCore, sendJson } from "./_core.js";

// GET /api/state — the whole brain: decisions, entities, open questions, each
// with status and provenance. mirrors getState() in src/api.ts.
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
  const core = getCore();
  const [decisions, entities, questions] = await Promise.all([
    core.getDecisions(),
    core.listEntities(),
    core.getOpenQuestions(),
  ]);
  sendJson(res, 200, { decisions, entities, questions, readOnly: READ_ONLY });
}
