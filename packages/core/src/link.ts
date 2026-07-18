import { type Decision, type Entity, type Goal } from "@marrowhq/shared";

// PR-06 and PR-17: keeps the graph alive and surfaces rule-based drift signals.
// light keyword-level signals on purpose; the semantic layer is the precision
// filter, this layer is the recall filter. nothing auto-resolves.

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "uses",
  "use",
  "using",
  "about",
  "what",
  "when",
  "where",
  "which",
  "their",
  "them",
  "they",
  "will",
  "would",
  "should",
  "could",
  "have",
  "has",
  "had",
  "but",
  "you",
  "your",
  "our",
  "its",
  "are",
  "was",
  "were",
  "been",
  "being",
  "now",
  "today",
  "from",
  "then",
  "than",
  "over",
  "also",
]);

const NEGATIONS = new Set([
  "no",
  "not",
  "without",
  "never",
  "cannot",
  "dont",
  "doesnt",
  "wont",
  "stop",
  "drop",
  "remove",
  "removed",
  "removing",
  "instead",
  "replace",
  "replaces",
  "kill",
  "killed",
]);

export function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value: string): string[] {
  return normalizeTitle(value).split(" ").filter(Boolean);
}

export function salientTerms(value: string): Set<string> {
  return new Set(words(value).filter((w) => w.length > 3 && !STOPWORDS.has(w)));
}

/** Salient terms the text negates (e.g. "passwords" in "no shared passwords"). */
export function negatedTerms(value: string): Set<string> {
  const out = new Set<string>();
  for (const term of salientTerms(value)) {
    if (negatesTerm(value, term)) out.add(term);
  }
  return out;
}

/** Salient terms the text affirms: every salient term it does not explicitly
 *  negate. an alternative after a negation ("no passwords, magic links only") is
 *  affirmed, not negated, even with no affirmation verb in front of it. */
export function affirmedTerms(value: string): Set<string> {
  const out = new Set<string>();
  for (const term of salientTerms(value)) {
    if (!negatesTerm(value, term)) out.add(term);
  }
  return out;
}

export interface DecisionSignals {
  negated: Set<string>;
  affirmed: Set<string>;
  salient: Set<string>;
}

export function decisionSignals(decision: Pick<Decision, "title" | "rationale">): DecisionSignals {
  const text = `${decision.title} ${decision.rationale}`;
  return {
    negated: negatedTerms(text),
    affirmed: affirmedTerms(text),
    salient: salientTerms(text),
  };
}

function clauses(text: string): string[][] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9,;:. ]+/g, " ")
    .split(/[,;:.]/)
    .map((clause) => clause.split(/\s+/).filter(Boolean));
}

function negatesTerm(text: string, term: string): boolean {
  for (const clause of clauses(text)) {
    const idx = clause.indexOf(term);
    if (idx < 0) continue;
    // only negations inside the same clause count; comma-separated alternatives
    // after a "no X" are not themselves negated.
    if (clause.slice(Math.max(0, idx - 3), idx).some((w) => NEGATIONS.has(w))) return true;
  }
  return false;
}

function variants(term: string): string[] {
  const out = [term];
  if (term.endsWith("s")) out.push(term.slice(0, -1));
  else out.push(`${term}s`);
  if (term.endsWith("es")) out.push(term.slice(0, -2));
  if (term.endsWith("ies")) out.push(`${term.slice(0, -3)}y`);
  return [...new Set(out)];
}

/** Tokenize source into whole identifier words: split camelCase (fooBar ->
 *  foo bar) first, then the shared tokenizer lowercases and splits on
 *  non-alphanumerics (snake_case, punctuation). So foo_bar, fooBar and "foo bar"
 *  all yield the same word set, and a decision term is matched as a whole word,
 *  never a substring: "sync" no longer matches "async", "test" not "latest",
 *  "auth" not "author". */
function codeTokens(code: string): Set<string> {
  return new Set(words(code.replace(/([a-z0-9])([A-Z])/g, "$1 $2")));
}

function codeMatchesTerm(codeWords: Set<string>, term: string): boolean {
  return variants(term).some((v) => codeWords.has(v));
}

export interface RuleDriftHit {
  term: string;
  kind: "negated" | "affirmed";
  confidence: number;
}

/** Rule-based drift signal. high-confidence when a negated term appears in the
 *  added code; lower-confidence when an affirmed term appears and the semantic
 *  layer should judge whether it is contradicted. */
export function ruleDriftSignal(
  code: string,
  decision: Pick<Decision, "title" | "rationale">,
): RuleDriftHit | undefined {
  const signals = decisionSignals(decision);
  const codeWords = codeTokens(code);

  for (const term of signals.negated) {
    if (codeMatchesTerm(codeWords, term)) {
      return { term, kind: "negated", confidence: 0.6 };
    }
  }

  // affirmed terms are only a weak drift signal when the decision negates
  // nothing. When a negation is present, the negated term is the precise drift
  // signal and an affirmed term appearing in code is consistency, not drift.
  if (signals.negated.size === 0) {
    for (const term of signals.affirmed) {
      if (codeMatchesTerm(codeWords, term)) {
        return { term, kind: "affirmed", confidence: 0.4 };
      }
    }
  }

  return undefined;
}

export interface GoalDriftHit {
  term: string;
  kind: "negated" | "affirmed";
  confidence: number;
}

/**
 * Rule-based goal drift signal. Mirrors ruleDriftSignal but for an aspirational
 * goal, so every confidence sits BELOW the matching decision signal: a goal is a
 * target the code is moving toward, not a constraint it must already satisfy, so
 * the maintenance layer flags it more softly and never out-shouts a decision.
 * The signal only ever feeds a question for a human; it never edits the goal
 * or treats code as product truth.
 */
export function goalDriftSignal(
  code: string,
  goal: Pick<Goal, "title" | "description">,
): GoalDriftHit | undefined {
  const text = `${goal.title} ${goal.description ?? ""}`;
  const negated = negatedTerms(text);
  const affirmed = affirmedTerms(text);
  const codeWords = codeTokens(code);

  // Code affirming a term the goal negates is the precise contradiction. Below
  // ruleDriftSignal's 0.6 negated confidence.
  for (const term of negated) {
    if (codeMatchesTerm(codeWords, term)) {
      return { term, kind: "negated", confidence: 0.45 };
    }
  }

  // An affirmed term in code is only a weak signal, and only when the goal
  // negates nothing. Below ruleDriftSignal's 0.4 affirmed confidence.
  if (negated.size === 0) {
    for (const term of affirmed) {
      if (codeMatchesTerm(codeWords, term)) {
        return { term, kind: "affirmed", confidence: 0.25 };
      }
    }
  }

  return undefined;
}

/**
 * A light conflict signal: a salient term that one decision affirms and the
 * other negates. Returns that shared term, or undefined when no conflict is
 * detected. It raises a question, it never auto-resolves a contradiction.
 */
export function decisionsConflict(
  a: Pick<Decision, "title" | "rationale">,
  b: Pick<Decision, "title" | "rationale">,
): string | undefined {
  const textA = `${a.title} ${a.rationale}`;
  const textB = `${b.title} ${b.rationale}`;
  const termsB = salientTerms(textB);
  for (const term of salientTerms(textA)) {
    if (!termsB.has(term)) continue;
    if (negatesTerm(textA, term) !== negatesTerm(textB, term)) return term;
  }
  return undefined;
}

/**
 * Goal-to-goal conflict, mirroring decisionsConflict: a shared salient term one
 * goal affirms and the other negates. Returns the term, or undefined. It only
 * raises a question; the room, not the merge, decides which goal holds.
 */
export function goalsConflict(
  a: Pick<Goal, "title" | "description">,
  b: Pick<Goal, "title" | "description">,
): string | undefined {
  return decisionsConflict(
    { title: a.title, rationale: a.description ?? "" },
    { title: b.title, rationale: b.description ?? "" },
  );
}

/**
 * The decisions that mention a salient word of the entity's name. These are the
 * `concerns` edges: an entity is the subject of a decision. Empty when the entity
 * has nothing distinctive to match on, or when no decision is about it (a gap).
 */
export function decisionsConcerningEntity<T extends Pick<Decision, "title" | "rationale">>(
  entity: Pick<Entity, "name">,
  decisions: T[],
): T[] {
  const terms = [...salientTerms(entity.name)];
  if (terms.length === 0) return [];
  return decisions.filter((decision) => {
    // whole-word membership, not substring: an entity named "auth" must not
    // match a decision that merely contains "author", which would forge a
    // bogus concerns edge and suppress a real gap question.
    const decWords = new Set(words(`${decision.title} ${decision.rationale}`));
    return terms.some((term) => decWords.has(term));
  });
}

/**
 * True if any decision references a salient word of the entity's name. When it
 * is false, the entity was mentioned but nothing was decided about it: a gap.
 */
export function entityHasDecision(
  entity: Pick<Entity, "name">,
  decisions: Pick<Decision, "title" | "rationale">[],
): boolean {
  const terms = [...salientTerms(entity.name)];
  if (terms.length === 0) return true; // nothing distinctive to gap on
  return decisionsConcerningEntity(entity, decisions).length > 0;
}
