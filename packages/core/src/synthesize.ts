// The synthesis digest headline, kept pure so it is testable in isolation.
// synthesize itself is a read-only pass: it summarizes what changed in a window
// and what deserves attention. It writes nothing.

export interface SynthCounts {
  windowDays: number;
  changed: number;
  newlyDecided: number;
  contested: number;
  driftCatches: number;
  staleDecided: number;
  openQuestions: number;
  undistilled: number;
}

/** One plain-language line summarizing a synthesis window. */
export function synthHeadline(c: SynthCounts): string {
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
  return (
    `In the last ${c.windowDays} day${c.windowDays === 1 ? "" : "s"}: ` +
    `${plural(c.changed, "fact")} changed, ` +
    `${c.newlyDecided} newly decided, ` +
    `${plural(c.contested, "contested fact")}, ` +
    `${plural(c.driftCatches, "drift catch")}, ` +
    `${c.staleDecided} stale, ` +
    `${plural(c.openQuestions, "open question")}, ` +
    `${plural(c.undistilled, "evidence row")} awaiting distillation.`
  );
}
