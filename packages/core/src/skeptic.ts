// The skeptic's reason logic, kept pure so it is testable in isolation. The
// skeptic is a fresh-context check on a model-proposed fact: it never sees the
// conversation that proposed the node, only the node's own evidence and the
// decided facts it might contradict. It attacks the proposal along three axes
// and returns the reasons it is weak; an empty list means it survived. It never
// changes a node's status: a verdict is advisory, and only a human answer
// promotes a fact.

export type VerifyReason = "single_source" | "weak_provenance" | "contradicts_decided";
export type VerifyVerdict = "survived" | "flagged";

// a cited span shorter than this is too thin to stand on its own.
const MIN_SPAN_CHARS = 12;
// a model confidence below this is a weak proposal on its own.
const MIN_CONFIDENCE = 0.5;

/**
 * The reasons a proposed node is weak. `decidedConflict` is computed by the
 * caller (a decision conflicting with a decided fact), so this stays free of the
 * store and the node-kind rules.
 * - single_source: every provenance span points at the same evidence row.
 * - weak_provenance: every cited span is very short, or the model confidence is low.
 * - contradicts_decided: the proposal contradicts an already-decided fact.
 */
export function skepticReasons(
  node: {
    confidence: { value: number };
    provenance: { evidenceId: string; start: number; end: number }[];
  },
  decidedConflict: boolean,
): VerifyReason[] {
  const reasons: VerifyReason[] = [];
  const evidenceIds = new Set(node.provenance.map((span) => span.evidenceId));
  if (evidenceIds.size <= 1) reasons.push("single_source");
  const shortSpans = node.provenance.every((span) => span.end - span.start < MIN_SPAN_CHARS);
  if (shortSpans || node.confidence.value < MIN_CONFIDENCE) reasons.push("weak_provenance");
  if (decidedConflict) reasons.push("contradicts_decided");
  return reasons;
}

export function verdictFor(reasons: VerifyReason[]): VerifyVerdict {
  return reasons.length === 0 ? "survived" : "flagged";
}
