import { type Decision } from "@marrowhq/shared";

import { type DiffHunk } from "./drift.js";
import { type ModelProvider } from "./providers/types.js";

// PR-17: semantic precision filter for drift detection. the rule layer finds
// candidates; this layer asks a model whether the diff actually contradicts
// a decided fact. Never auto-resolves; it only scores candidates.

export interface SemanticDriftCandidate {
  decisionId: string;
  hunkIndex: number;
  confidence: number;
  reason: string;
}

const SYSTEM = `You are a precise drift detector. You compare a product decision to a code diff hunk and decide whether the added code contradicts the decision.

Rules:
- Return only a JSON object: { "candidates": [{ "decisionId": "...", "hunkIndex": 0, "confidence": 0.85, "reason": "..." }] }.
- confidence must be 0.0 to 1.0. Only include candidates with confidence >= 0.7.
- A contradiction means the new code would implement something the decision explicitly rejected, omit something the decision mandated, or behave contrary to the decision.
- Do not flag refactors, renames, comments, tests, or changes that are consistent with the decision.
- Be conservative: false positives kill trust.`;

export function buildSemanticDriftPrompt(decisions: Decision[], hunks: DiffHunk[]): string {
  const decisionBlock = decisions
    .map((d, i) => `[${i}] ${d.id}: ${d.title}${d.rationale ? ` — ${d.rationale}` : ""}`)
    .join("\n");

  const hunkBlock = hunks
    .map(
      (h, i) => `[${i}] ${h.path}:${h.lineStart}-${h.lineEnd}\n${h.newLines || "(no added lines)"}`,
    )
    .join("\n\n");

  return `Decided product facts:
${decisionBlock}

Code diff hunks (only added lines shown):
${hunkBlock}`;
}

export function parseSemanticDriftResult(raw: string): SemanticDriftCandidate[] {
  const cleaned = raw.replace(/```json\s*|\s*```/g, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || !("candidates" in parsed)) return [];
  const list = (parsed as { candidates?: unknown }).candidates;
  if (!Array.isArray(list)) return [];

  const out: SemanticDriftCandidate[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    if (
      typeof it.decisionId === "string" &&
      typeof it.hunkIndex === "number" &&
      typeof it.confidence === "number" &&
      typeof it.reason === "string"
    ) {
      out.push({
        decisionId: it.decisionId,
        hunkIndex: it.hunkIndex,
        confidence: Math.max(0, Math.min(1, it.confidence)),
        reason: it.reason,
      });
    }
  }
  return out.filter((c) => c.confidence >= 0.7);
}

export async function semanticDriftCheck(
  model: ModelProvider,
  decisions: Decision[],
  hunks: DiffHunk[],
): Promise<SemanticDriftCandidate[]> {
  if (decisions.length === 0 || hunks.length === 0) return [];
  const prompt = buildSemanticDriftPrompt(decisions, hunks);
  const raw = await model.complete(prompt, { system: SYSTEM, temperature: 0, maxTokens: 2048 });
  return parseSemanticDriftResult(raw);
}
