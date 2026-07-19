import type { IncomingMessage, ServerResponse } from "node:http";

import { getStore, route, sendJson } from "../../_core.js";

// GET /api/catches — list all drift catches with status, metrics
async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
  const store = getStore();

  const events = await store.listCatchEvents({ eventType: "catch_surfaced" });
  const views: {
    id: string;
    status: "open" | "acted-on" | "dismissed";
    decisionId: string;
    decisionTitle: string;
    decisionSourceLabel: string;
    path: string | undefined;
    lineStart: number | undefined;
    lineEnd: number | undefined;
    hunkText: string;
    verdict: "warn" | "contradiction";
    confidence: number;
    modelUsed: string | undefined;
    surfacedAt: string;
    trigger: string;
  }[] = [];

  for (const event of events) {
    if (!event.question_id || !event.decision_id) continue;
    const question = await store.getQuestion(event.question_id);
    const decision = await store.getNode(event.decision_id);
    if (!question || !decision || decision.kind !== "decision") continue;

    let status: "open" | "acted-on" | "dismissed" = "open";
    if (question.status === "decided" || question.status === "superseded") status = "acted-on";
    else if (question.status === "dismissed") status = "dismissed";

    const sourceLabel = `${decision.provenance.length} evidence span${
      decision.provenance.length === 1 ? "" : "s"
    }`;

    views.push({
      id: question.id,
      status,
      decisionId: decision.id,
      decisionTitle: decision.title,
      decisionSourceLabel: sourceLabel,
      path: event.diff_span?.path,
      lineStart: event.diff_span?.lineStart,
      lineEnd: event.diff_span?.lineEnd,
      hunkText: event.diff_span?.hunkText ?? "",
      verdict: (event.confidence ?? 0) >= 0.65 ? "contradiction" : "warn",
      confidence: event.confidence ?? 0,
      modelUsed: event.model_used ?? undefined,
      surfacedAt: event.created_at,
      trigger: event.trigger,
    });
  }

  views.sort((a, b) => b.surfacedAt.localeCompare(a.surfacedAt));
  sendJson(res, 200, views);
}

export default route(handler);
