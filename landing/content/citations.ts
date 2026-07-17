// Every citation on the page, one source. The texts are verbatim slices of
// the seed documents (packages/core/src/demo.ts DEMO_INTERVIEW and
// packages/web/scripts/seed-room.ts); scripts/check-ids.mjs verifies each one
// against the seeds in the built HTML. The landing may only cite seeded
// facts, forever.
export type Citation = {
  ev: string;
  span: readonly [number, number];
  /** verbatim seed text for highlighted marks */
  text: string;
};

export const CITE = {
  cardForm: {
    ev: "ev_3f9a",
    span: [294, 344],
    text: "every support ticket in week one was the card form",
  },
  noCard: {
    ev: "ev_3f9a",
    span: [440, 478],
    text: "Free trial, no card until they convert",
  },
  sellsInternally: {
    ev: "ev_3f9a",
    span: [500, 541],
    text: "That is the version I can sell internally",
  },
  annualBilling: {
    ev: "ev_3f9a",
    span: [610, 669],
    text: "What about annual billing? Finance put it on the pilot deck",
  },
  oldPlan: {
    ev: "ev_77c1",
    span: [152, 204],
    text: "The old plan where launch needed a card wall is dead",
  },
  trialShort: {
    ev: "ev_77c1",
    span: [272, 302],
    text: "I want the trial cut to 7 days",
  },
  trialLong: {
    ev: "ev_77c1",
    span: [359, 384],
    text: "Keep the trial at 14 days",
  },
  notSettled: {
    ev: "ev_77c1",
    span: [469, 523],
    text: "We did not settle it. Parking it for the growth review",
  },
  pricing: {
    ev: "ev_9b2e",
    span: [62, 103],
    text: "per workspace, flat, no per-seat counting",
  },
  editor: {
    ev: "ev_41c2",
    span: [116, 153],
    text: "If the editor freezes when wifi drops",
  },
} as const satisfies Record<string, Citation>;

/** data-span attribute value: plain hyphen, machine-facing. */
export const spanAttr = (c: Citation) => `${c.span[0]}-${c.span[1]}`;

/** visible reference label: en dash inside the brackets, the page's grammar. */
export const refLabel = (c: Citation, sep: "space" | "dot" = "space") =>
  `${c.ev}${sep === "dot" ? " · " : " "}[${c.span[0]}–${c.span[1]}]`;
