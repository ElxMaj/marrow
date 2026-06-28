import type { IncomingMessage, ServerResponse } from "node:http";

import { getStore, sendJson } from "../../_core.js";

// GET /api/catches/metrics — aggregate catch metrics
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
  const store = getStore();
  const metrics = await store.getCatchMetrics({ excludeSynthetic: true });
  sendJson(res, 200, {
    surfaced: metrics.surfaced,
    actedOn: metrics.actedOn,
    dismissed: metrics.dismissed,
    precision: metrics.precision ?? 0,
    dismissRate: metrics.dismissRate ?? 0,
  });
}
