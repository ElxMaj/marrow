import { CITE, type Citation } from "./citations";

// The terminal reenactment's script. Output strings mirror what
// `npx @marrowhq/cli demo` actually prints (packages/cli/src/main.ts and the
// numbered summary in packages/core/src/demo.ts), so the reenactment never
// over-claims. The one departure is interactive honesty: the CLI answers its
// own question in step 2; here the visitor is the human, so the run stops at
// the prompt until they decide, and it respects "leave it open".
export type TermLine =
  | { kind: "cmd"; text: string }
  | { kind: "out"; text: string }
  | {
      kind: "fact";
      status: "open" | "decided" | "entity";
      title: string;
      conf: string;
      cite: Citation;
      /** decided facts carry the decided face in the slice grammar */
      decidedFace?: boolean;
    }
  | { kind: "quote"; cite: Citation; attribution: string }
  | { kind: "agent"; text: string }
  | { kind: "tally"; text: string };

export type TermStep = {
  id: "ingest" | "distill" | "question" | "promote" | "prepare";
  label: string;
  /** lines appended when the step runs; promote/prepare vary by the visitor's call */
  lines: (opts: { open: boolean }) => TermLine[];
};

export const DECISION_TITLE = "Free trial, no card upfront";

export const TERM_STEPS: TermStep[] = [
  {
    id: "ingest",
    label: "ingest",
    lines: () => [
      { kind: "cmd", text: "npx @marrowhq/cli demo" },
      { kind: "out", text: "Ingested interviews/design-partner.md as ev_3f9a. Append only." },
      {
        kind: "out",
        text: "The wider room is already on file: ev_77c1 standup, ev_9b2e pricing call.",
      },
    ],
  },
  {
    id: "distill",
    label: "distill",
    lines: () => [
      { kind: "out", text: "Distilled 1 decision, 2 entities. Every fact carries a span." },
      {
        kind: "fact",
        status: "open",
        title: DECISION_TITLE,
        conf: "0.60 model",
        cite: CITE.noCard,
      },
      { kind: "quote", cite: CITE.noCard, attribution: "maya · [00:11:27]" },
    ],
  },
  {
    id: "question",
    label: "question",
    lines: () => [
      {
        kind: "out",
        text: 'The loop raised a question: "annual billing" has no decision behind it.',
      },
      { kind: "out", text: "And one for you:" },
    ],
  },
  {
    id: "promote",
    label: "promote",
    lines: ({ open }) =>
      open
        ? [
            { kind: "out", text: "Left open. The agent will ask before building." },
            {
              kind: "out",
              text: "Confidence stays 0.60 (model). Recorded in this reenactment only.",
            },
          ]
        : [
            { kind: "out", text: `Decision  [decided]  ${DECISION_TITLE}` },
            { kind: "out", text: "Confidence 1.00 (human). Recorded in this reenactment only." },
          ],
  },
  {
    id: "prepare",
    label: "prepare_task",
    lines: ({ open }) => [
      { kind: "cmd", text: 'prepare_task({ task: "require a card at signup" })' },
      {
        kind: "fact",
        status: open ? "open" : "decided",
        title: DECISION_TITLE,
        conf: open ? "0.60 model" : "1.00 human",
        cite: CITE.noCard,
        decidedFace: !open,
      },
      {
        kind: "fact",
        status: "decided",
        title: "Pricing is per workspace, flat",
        conf: "1.00 human",
        cite: CITE.pricing,
        decidedFace: true,
      },
      {
        kind: "fact",
        status: "open",
        title: "Trial length: 7 days or 14 days",
        conf: "0.60 model",
        cite: CITE.notSettled,
      },
      {
        kind: "fact",
        status: "entity",
        title: "Annual billing",
        conf: "0.85 model",
        cite: CITE.annualBilling,
      },
      {
        kind: "agent",
        text: "agent: trial length is still open (ev_77c1), asking before building.",
      },
      {
        kind: "tally",
        text: `4 task-scoped results, each carrying status + provenance. Still open: ${
          open ? "2 questions" : "1 question"
        }.`,
      },
    ],
  },
];
