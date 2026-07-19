import type { IncomingMessage, ServerResponse } from "node:http";

import { READ_ONLY, getCore, readJson, route, sendJson } from "./_core.js";

// POST /api/answer — the promote-to-decided path. refused in the hosted demo so
// a seeded brain stays as seeded. locally (MARROW_READ_ONLY unset) it works.
async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
  if (READ_ONLY) {
    return sendJson(res, 403, { error: "this is a read-only demo; answering is disabled" });
  }
  const body = await readJson(req);
  const questionId = body.questionId as string | undefined;
  const text = body.text;
  const decide = body.decide as string | undefined;
  if (!questionId || typeof text !== "string") {
    return sendJson(res, 400, { error: "questionId and text are required" });
  }
  sendJson(
    res,
    200,
    await getCore().answer(questionId, text, decide !== undefined ? { decide } : {}),
  );
}

export default route(handler);
