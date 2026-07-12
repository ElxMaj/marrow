import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type Extraction } from "./distill.js";

// The extraction policy: the deterministic half of "what never becomes a
// durable node". The distill prompt asks the model to skip transient chatter
// (the soft layer); this module is the guarantee, a fixed post-extraction
// filter that drops matching items BEFORE anything is inserted. Evidence is
// always stored either way: policy gates what gets proposed as distilled
// truth, never what the room recorded.

export interface MarrowPolicy {
  /** Regex sources tested against each extracted item's title plus quote.
   *  A match drops the item deterministically. */
  denyPatterns: string[];
  /** Source labels (with * wildcards) whose evidence is stored but never
   *  auto-distilled: scratch channels, bot feeds, private notes. */
  noDistillSources: string[];
  /** Category names fed to the distill prompt as a skip list (soft layer). */
  neverDistill: string[];
}

/** Conservative defaults: obvious calendar chatter and greetings. Everything
 *  here matches extracted item text, not whole transcripts, so a real
 *  decision about a scheduling FEATURE never trips it. */
export const DEFAULT_POLICY: MarrowPolicy = {
  denyPatterns: [
    "\\b(standup|sync|meeting|call|1:1)\\b.{0,40}\\b(moved|resched|postpon|tomorrow|next (week|monday|tuesday|wednesday|thursday|friday)|at \\d{1,2}(:\\d{2})?\\s*(am|pm)?)\\b",
    "^\\s*(hi|hello|hey|thanks|thank you|good (morning|afternoon))\\b",
  ],
  noDistillSources: [],
  neverDistill: ["transient scheduling details", "greetings and smalltalk"],
};

/** Load .marrow/policy.json from the given directory, merged over the
 *  defaults. A missing or unreadable file means the defaults, silently: the
 *  policy must never make ingestion fail. */
export function loadPolicy(dir: string = process.cwd()): MarrowPolicy {
  try {
    const raw = JSON.parse(readFileSync(join(dir, ".marrow", "policy.json"), "utf8")) as Partial<
      Record<keyof MarrowPolicy, unknown>
    >;
    const list = (value: unknown): string[] | undefined =>
      Array.isArray(value) && value.every((entry) => typeof entry === "string")
        ? (value as string[])
        : undefined;
    return {
      denyPatterns: list(raw.denyPatterns) ?? DEFAULT_POLICY.denyPatterns,
      noDistillSources: list(raw.noDistillSources) ?? DEFAULT_POLICY.noDistillSources,
      neverDistill: list(raw.neverDistill) ?? DEFAULT_POLICY.neverDistill,
    };
  } catch {
    return DEFAULT_POLICY;
  }
}

/** True when a source label matches one of the policy's no-distill globs. */
export function matchesNoDistillSource(policy: MarrowPolicy, source: string): boolean {
  return policy.noDistillSources.some((glob) => {
    const pattern = `^${glob.split("*").map(escapeRegex).join(".*")}$`;
    return new RegExp(pattern, "i").test(source);
  });
}

/** The prompt clause for the soft layer; empty string when nothing to say. */
export function policyPromptClause(policy: MarrowPolicy): string {
  if (policy.neverDistill.length === 0) return "";
  return `Never extract items about: ${policy.neverDistill.join("; ")}. When in doubt about those categories, drop the item.`;
}

/** The deterministic filter: drop extracted items whose title plus quote
 *  match a deny pattern. Returns the surviving extraction and the drop count,
 *  so the run trace can show filtered volume. Invalid patterns are skipped:
 *  a broken policy line must never take distillation down. */
export function filterExtraction(
  extraction: Extraction,
  policy: MarrowPolicy,
): { extraction: Extraction; dropped: number } {
  const patterns: RegExp[] = [];
  for (const source of policy.denyPatterns) {
    try {
      patterns.push(new RegExp(source, "i"));
    } catch {
      // skip a malformed pattern rather than failing the whole distill pass.
    }
  }
  if (patterns.length === 0) return { extraction, dropped: 0 };
  let dropped = 0;
  const keep = <T extends { quote?: string | undefined }>(items: T[], text: (item: T) => string) =>
    items.filter((item) => {
      const haystack = `${text(item)} ${item.quote ?? ""}`;
      const hit = patterns.some((pattern) => pattern.test(haystack));
      if (hit) dropped += 1;
      return !hit;
    });
  const filtered: Extraction = {
    ...extraction,
    entities: keep(extraction.entities, (item) => item.name),
    decisions: keep(extraction.decisions, (item) => item.title),
    goals: keep(extraction.goals, (item) => item.title),
    questions: keep(extraction.questions, (item) => item.prompt),
  };
  return { extraction: filtered, dropped };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
