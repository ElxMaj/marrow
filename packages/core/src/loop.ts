import { type Question } from "@marrowhq/shared";

// The question loop is what stops the brain rotting into notes. Open questions
// are surfaced by impact so the developer settles the consequential ones first:
// a contested decision outranks an ambiguity outranks a minor gap.

export function questionImpact(question: Pick<Question, "prompt" | "relatesTo">): number {
  const prompt = question.prompt.toLowerCase();
  // a conflict relates two or more decisions ("which one holds?"), the
  // structural signal; the keyword is a fallback for conflicts phrased
  // differently. ranking on prompt wording alone was brittle: a drift question
  // or a custom-proposed conflict could mis-rank as a trivial ambiguity.
  const relatesToCount = question.relatesTo?.length ?? 0;
  if (relatesToCount >= 2 || /conflict|contradict/.test(prompt)) return 3;
  if (/drift/.test(prompt)) return 2; // code diverging from a decided fact
  if (/never decided|specify|gap/.test(prompt)) return 1; // a minor gap
  return 2; // an ambiguity
}

/** Order open questions by impact, then newest first within the same impact. */
export function rankQuestions(questions: Question[]): Question[] {
  return [...questions].sort((a, b) => {
    const byImpact = questionImpact(b) - questionImpact(a);
    if (byImpact !== 0) return byImpact;
    return b.createdAt.localeCompare(a.createdAt);
  });
}
