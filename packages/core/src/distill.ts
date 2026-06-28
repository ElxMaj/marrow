import { type Decision, type Entity, type Goal, type Question } from "@marrowhq/shared";
import { z } from "zod";

// Distillation turns one evidence row into entities, decisions, goals and
// questions, each cited to an exact character span in that evidence. It never
// promotes: every node comes in as `open` with a model confidence. Re-running
// reconciles against what already exists instead of duplicating.

export type Distilled = Entity | Decision | Question | Goal;

export const DISTILL_SYSTEM = [
  "You distill product truth from a room transcript (interview, standup, notes).",
  "Extract only what the text explicitly supports. Never invent. If the room decided nothing, return empty lists.",
  "Return four lists:",
  "- entities: things the product talks about (features, components, personas, integrations).",
  "- decisions: choices the room CLEARLY COMMITTED to. A tentative or leaning choice ('we are probably going with X', 'let us confirm next week') is NOT a decision; record it as a question instead.",
  "- goals: outcomes or targets the room committed to (what the product or a user must ACHIEVE), distinct from a decision (a choice of HOW). Tag each `goalType` 'product' (what the product must do) or 'user' (what a user must be able to do).",
  "- questions: open threads, ambiguities, gaps, or unconfirmed leanings.",
  "For every item, return `quote`: the exact, verbatim substring of the provided text that supports it. Copy it character for character; do not paraphrase, trim, or fix typos. If you cannot quote a supporting span, drop the item.",
  "Set `confidence` between 0 and 1: high (>= 0.8) for an explicit commitment ('we decided', 'we agreed'), low (<= 0.4) for a tentative or inferred item.",
  "Return strict JSON only, no prose, shaped as:",
  '{"entities":[{"name","description","quote","confidence"}],"decisions":[{"title","rationale","constraint","quote","confidence"}],"goals":[{"title","description","goalType","quote","confidence"}],"questions":[{"prompt","quote","confidence"}]}',
].join("\n");

export function buildDistillPrompt(text: string): string {
  return [
    "Distill the following text. Character offsets must index into it exactly as given.",
    "",
    "<<<TEXT",
    text,
    "TEXT",
  ].join("\n");
}

const spanFields = {
  // The model returns a verbatim `quote`; `start`/`end` are accepted only as a
  // legacy fallback for offset-based callers (the demo, older fixtures).
  quote: z.string().optional(),
  start: z.number().int().optional(),
  end: z.number().int().optional(),
  confidence: z.number().min(0).max(1).optional(),
};

export const ExtractionSchema = z
  .object({
    entities: z
      .array(
        z
          .object({ name: z.string(), description: z.string().optional(), ...spanFields })
          .passthrough(),
      )
      .optional()
      .default([]),
    decisions: z
      .array(
        z
          .object({
            title: z.string(),
            rationale: z.string().optional(),
            constraint: z.boolean().optional(),
            ...spanFields,
          })
          .passthrough(),
      )
      .optional()
      .default([]),
    goals: z
      .array(
        z
          .object({
            title: z.string(),
            description: z.string().optional(),
            goalType: z.enum(["product", "user"]).optional().default("product"),
            ...spanFields,
          })
          .passthrough(),
      )
      .optional()
      .default([]),
    questions: z
      .array(z.object({ prompt: z.string(), ...spanFields }).passthrough())
      .optional()
      .default([]),
  })
  .passthrough();

export type Extraction = z.infer<typeof ExtractionSchema>;

/** Pull the JSON object out of a model response (tolerating code fences and
 *  surrounding prose) and validate its shape. Fails loud if there is no JSON. */
export function parseExtraction(raw: string): Extraction {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("distill: model response contained no JSON object");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error("distill: model response was not valid JSON");
  }
  return ExtractionSchema.parse(parsed);
}

export interface ResolvedSpan {
  start: number;
  end: number;
  text: string;
}

/**
 * Resolve an extracted item to a real, non-empty span in the text. Preferred
 * path: locate the model's verbatim `quote` with indexOf, because counting exact
 * character offsets across a long transcript is the single most reliable thing
 * an LLM gets wrong. So we never trust raw offsets when a quote is given; if the
 * quote is not present verbatim, the node is dropped (fail loud, no
 * plausible-but-wrong provenance). `start`/`end` are honored only as a legacy
 * fallback when no quote was provided. Returns undefined to drop the node.
 */
export function resolveSpan(
  text: string,
  item: { quote?: string | undefined; start?: number | undefined; end?: number | undefined },
): ResolvedSpan | undefined {
  if (item.quote !== undefined && item.quote.length > 0) {
    const start = text.indexOf(item.quote);
    if (start < 0) return undefined;
    return { start, end: start + item.quote.length, text: item.quote };
  }
  const { start, end } = item;
  if (typeof start !== "number" || typeof end !== "number") return undefined;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return undefined;
  if (start < 0 || end > text.length || end <= start) return undefined;
  const slice = text.slice(start, end);
  return slice.length > 0 ? { start, end, text: slice } : undefined;
}

/**
 * Split text into chunks no larger than maxChars, breaking on paragraph then
 * line boundaries. distillation runs per chunk so a long transcript never
 * overruns the model's output budget; every quote is still located back in the
 * full evidence text, so spans stay correct regardless of where a chunk fell.
 */
export function chunkText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let current = "";
  const flush = (): void => {
    if (current.length > 0) chunks.push(current);
    current = "";
  };
  const add = (piece: string, sep: string): void => {
    // a piece larger than the budget on its own (a wall of text with no
    // paragraph or line breaks) is hard-sliced, so no chunk ever exceeds
    // maxChars and the model output budget is always respected.
    if (piece.length > maxChars) {
      flush();
      for (let i = 0; i < piece.length; i += maxChars) chunks.push(piece.slice(i, i + maxChars));
      return;
    }
    if (current.length > 0 && current.length + sep.length + piece.length > maxChars) flush();
    current = current.length > 0 ? `${current}${sep}${piece}` : piece;
  };
  for (const para of text.split(/\n\n+/)) {
    if (para.length <= maxChars) {
      add(para, "\n\n");
      continue;
    }
    flush();
    for (const line of para.split(/\n/)) add(line, "\n");
  }
  flush();
  return chunks.length > 0 ? chunks : [text];
}

/** Stable dedupe key: kind + normalized title + the exact span. re-running
 *  distillation on the same evidence produces the same keys, so nothing dupes. */
export function distilledKey(kind: string, title: string, start: number, end: number): string {
  const normalized = title.toLowerCase().replace(/\s+/g, " ").trim();
  return `${kind}|${normalized}|${start}|${end}`;
}

/** Recompute the dedupe key for an already-stored node, using the span that
 *  cites the given evidence. */
export function nodeKey(node: Distilled, evidenceId: string): string {
  const span = node.provenance.find((s) => s.evidenceId === evidenceId) ?? node.provenance[0];
  const title =
    node.kind === "entity"
      ? node.name
      : node.kind === "decision"
        ? node.title
        : node.kind === "goal"
          ? node.title
          : node.prompt;
  return distilledKey(node.kind, title, span?.start ?? -1, span?.end ?? -1);
}
