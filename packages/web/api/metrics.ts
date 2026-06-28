import type { IncomingMessage, ServerResponse } from "node:http";

import { getStore, sendJson } from "./_core.js";

// GET /api/metrics — aggregate observability over an optional window: counts,
// error rate, token totals, cost, and latency percentiles. mirrors
// store.runMetrics; the dashboard header reads it.
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
  const url = new URL(req.url ?? "/", "http://localhost");
  const since = url.searchParams.get("since") ?? undefined;
  const until = url.searchParams.get("until") ?? undefined;
  sendJson(
    res,
    200,
    await getStore().runMetrics({ ...(since ? { since } : {}), ...(until ? { until } : {}) }),
  );
}
