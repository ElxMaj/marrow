import type { IncomingMessage, ServerResponse } from "node:http";

import { READ_ONLY, getCore, getStore, goalViews, readJson, sendJson } from "./_core.js";

// /api/goals — the Goals space.
//   GET  lists goals (decided + open) with status, provenance and the entity
//        each one serves. Optional ?status / ?goalType filters. Read-only.
//   POST authors a goal: a HUMAN action, so core lands it decided with a human
//        confidence and captures the authored text as immutable evidence. refused
//        in a read-only demo. the web owns no promote logic; this is a passthrough.
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "GET") {
    const url = new URL(req.url ?? "/", "http://localhost");
    const status = url.searchParams.get("status") ?? undefined;
    const goalType = url.searchParams.get("goalType");
    return sendJson(
      res,
      200,
      await goalViews(getStore(), {
        ...(status ? { status } : {}),
        ...(goalType === "product" || goalType === "user" ? { goalType } : {}),
      }),
    );
  }

  if (req.method === "POST") {
    if (READ_ONLY)
      return sendJson(res, 403, { error: "this is a read-only demo; writes are disabled" });
    const body = await readJson(req);
    const title = body.title;
    const goalType = body.goalType;
    const description = body.description as string | undefined;
    const entityId = body.entityId as string | undefined;
    if (
      typeof title !== "string" ||
      !title.trim() ||
      (goalType !== "product" && goalType !== "user")
    ) {
      return sendJson(res, 400, { error: "title and goalType (product|user) are required" });
    }
    const goal = await getCore().authorGoal({
      title,
      ...(description ? { description } : {}),
      goalType,
      ...(entityId ? { entityId } : {}),
    });
    return sendJson(res, 200, goal);
  }

  sendJson(res, 405, { error: "method not allowed" });
}
