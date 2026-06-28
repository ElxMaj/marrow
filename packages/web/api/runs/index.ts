import type { IncomingMessage, ServerResponse } from "node:http";

import type { RunKind, RunStatus } from "@marrowhq/shared";

import { getStore, sendJson } from "../_core.js";

// GET /api/runs?kind=&status=&limit=&before= — recent runs, newest first,
// bounded. mirrors store.listRuns; the observability table reads it.
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
  const url = new URL(req.url ?? "/", "http://localhost");
  const kind = url.searchParams.get("kind") as RunKind | null;
  const status = url.searchParams.get("status") as RunStatus | null;
  const before = url.searchParams.get("before");
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  sendJson(
    res,
    200,
    await getStore().listRuns({
      ...(kind ? { kind } : {}),
      ...(status ? { status } : {}),
      ...(before ? { before } : {}),
      ...(limit && Number.isFinite(limit) ? { limit } : {}),
    }),
  );
}
