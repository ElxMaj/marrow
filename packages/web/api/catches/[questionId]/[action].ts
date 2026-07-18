import type { IncomingMessage, ServerResponse } from "node:http";

import { READ_ONLY, getCore, readJson, route, sendJson } from "../../_core.js";

// POST /api/catches/:questionId/accept — accept a catch (mark as acted on)
// POST /api/catches/:questionId/dismiss — dismiss a catch (mark as noise)
async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
  if (READ_ONLY)
    return sendJson(res, 403, { error: "this is a read-only demo; writes are disabled" });

  const url = new URL(req.url ?? "/", "http://localhost");
  const pathParts = url.pathname.split("/").filter(Boolean);
  const questionId = pathParts[2]; // /api/catches/:questionId/...
  const action = pathParts[3]; // accept or dismiss

  if (!questionId || (action !== "accept" && action !== "dismiss")) {
    return sendJson(res, 404, { error: "not found" });
  }

  const body = await readJson(req);
  const core = getCore();

  try {
    if (action === "accept") {
      const resolution = body.resolution as string | undefined;
      if (!resolution || typeof resolution !== "string") {
        return sendJson(res, 400, { error: "resolution is required" });
      }
      await core.acceptCatch(questionId, resolution);
    } else {
      const reason = body.reason as string | undefined;
      if (!reason || typeof reason !== "string") {
        return sendJson(res, 400, { error: "reason is required" });
      }
      await core.dismissCatch(questionId, reason);
    }
    sendJson(res, 200, { ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    sendJson(res, 400, { error: msg });
  }
}

export default route(handler);
