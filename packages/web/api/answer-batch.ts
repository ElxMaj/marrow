import type { IncomingMessage, ServerResponse } from "node:http";

import { READ_ONLY, getCore, sendJson } from "./_core.js";

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new Error("request body too large");
    chunks.push(Buffer.from(chunk as Buffer));
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function parseAnswers(
  value: unknown,
): { questionId: string; text: string; decide?: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: { questionId: string; text: string; decide?: string }[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return undefined;
    const record = item as Record<string, unknown>;
    if (typeof record.questionId !== "string" || typeof record.text !== "string") {
      return undefined;
    }
    if (record.decide !== undefined && typeof record.decide !== "string") return undefined;
    out.push({
      questionId: record.questionId,
      text: record.text,
      ...(record.decide !== undefined ? { decide: record.decide } : {}),
    });
  }
  return out;
}

// POST /api/answer-batch — promote several questions at once.
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
  if (READ_ONLY) {
    return sendJson(res, 403, { error: "this is a read-only demo; answering is disabled" });
  }
  const body = await readJson(req);
  const answers = parseAnswers(body.answers);
  if (!answers) {
    return sendJson(res, 400, {
      error: "Answers must be an array of { questionId, text, decide? }",
    });
  }
  sendJson(res, 200, await getCore().answerBatch(answers));
}
