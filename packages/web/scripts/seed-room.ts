// The shared product room used by both seeds. No side effects on import: a
// module the demo seed and the console seed both pull widenTheRoom from, so the
// two never drift. The hero interview itself is core's DEMO_INTERVIEW; this adds
// the surrounding standups, reviews and pricing notes as immutable evidence,
// proposes nodes with verbatim-quote spans, promotes some through the answer
// loop, and leaves one conflict open so the picker shows.
import { type Marrow } from "@marrowhq/core";

type RoomSeedCore = Pick<Marrow, "ingest" | "proposeNode" | "answer">;

export const STANDUP = `# Standup 2026-06-02

priya: No-card signup shipped to staging like we agreed. QA started a trial this morning without a billing form in sight.

priya: The old plan where launch needed a card wall is dead, the free trial replaced it.

marco: The open one is trial length. I want the trial cut to 7 days, a long trial goes cold before anyone converts.

priya: Keep the trial at 14 days. Activation takes two weekends, teams hit the aha moment on the second one.

marco: We did not settle it. Parking it for the growth review.

lena: The editor drops every time someone is on hotel wifi and their edits vanish. It has to keep working offline and sync when the connection is back.

lena: Also the failed-payment retries fired four times in an hour last night for the annual plans. The backoff is too tight, someone has to look this week.
`;

export const REVIEW = `# Interview: acme design partner review, 2026-06-04

facilitator: What breaks when your connection drops?

partner: If the editor freezes when wifi drops we lose whatever we were typing. It has to keep working offline and catch up when we reconnect, the network is not our problem.

facilitator: And billing?

partner: For overages we want either a hard cap or a clear charge, the team has not agreed which. Half our months we blow past the included usage and the invoice is a surprise.

facilitator: Anything you want to see in the editor itself?

partner: The team wants to see who else is viewing a doc, presence dots, so two people do not overwrite each other. Though some folks find that a little surveillance-y.
`;

export const PRICING_CALL = `# Notes: pricing call, 2026-05-28

We keep coming back to it: per workspace, flat, no per-seat counting. The founders hate metered seats, they want one number per workspace per month they can forecast.

Agreed to revisit annual plans later. Annual plans that fail the card retry should pause the workspace, not cancel it, but nobody wrote down after how many tries.
`;

/** locate a verbatim quote in an evidence doc and return its exact span.
 *  Fails loud: a seed with a wrong quote must not produce a fact without a
 *  real source. */
export function spanOf(
  evidenceId: string,
  text: string,
  quote: string,
): { evidenceId: string; start: number; end: number } {
  const start = text.indexOf(quote);
  if (start === -1)
    throw new Error(`seed-room: quote not found in evidence: "${quote.slice(0, 50)}…"`);
  return { evidenceId, start, end: start + quote.length };
}

export async function widenTheRoom(core: RoomSeedCore): Promise<void> {
  // the room arrives as evidence first, verbatim, append only.
  const standupId = await core.ingest({ text: STANDUP, source: "standups/2026-06-02.md" });
  const reviewId = await core.ingest({ text: REVIEW, source: "interviews/design-review.md" });
  const pricingId = await core.ingest({
    text: PRICING_CALL,
    source: "notes/pricing-call-2026-05-28.md",
  });

  // -- the launch-trial decision itself lives in core's DEMO_INTERVIEW (the
  //    hero slice ingests and decides it); the standup here is its aftermath:
  //    shipped, the old card-wall plan superseded, and trial length left open.
  //    that decided fact is what surfaces as drift when a repo adds a card wall.

  // -- the editor goes offline-first: heard in two rooms, then locked by a human.
  const offline = await core.proposeNode({
    kind: "decision",
    title: "The editor works offline and syncs when the connection returns",
    rationale: "Wifi drops mid-edit and unsynced work vanishes",
    provenance: [
      spanOf(
        standupId,
        STANDUP,
        "It has to keep working offline and sync when the connection is back",
      ),
      spanOf(reviewId, REVIEW, "It has to keep working offline and catch up when we reconnect"),
    ],
    confidence: 0.8,
  });
  const offlineQ = await core.proposeNode({
    kind: "question",
    prompt: "Offline editing came up with two design partners. Lock it as a requirement?",
    relatesTo: [offline.id],
    provenance: offline.provenance,
    confidence: 0.7,
  });
  await core.answer(
    offlineQ.id,
    "Yes. The editor queues edits locally and reconciles on reconnect.",
  );

  // -- pricing: decided on the call, confirmed in the loop.
  const pricing = await core.proposeNode({
    kind: "decision",
    title: "Pricing is per workspace, flat, no per-seat metering",
    rationale: "The founders want one predictable number per workspace per month",
    provenance: [spanOf(pricingId, PRICING_CALL, "per workspace, flat, no per-seat counting")],
    confidence: 0.75,
  });
  const pricingQ = await core.proposeNode({
    kind: "question",
    prompt: "Confirm per-workspace pricing before the website copy goes out.",
    relatesTo: [pricing.id],
    provenance: pricing.provenance,
    confidence: 0.7,
  });
  await core.answer(
    pricingQ.id,
    "Confirmed, per workspace flat. No seat counting anywhere in the product.",
  );

  // -- trial length: the room split, two open decisions, one conflict the
  //    human has to settle. This is the picker the demo exists to show.
  const trialShort = await core.proposeNode({
    kind: "decision",
    title: "The trial is cut to 7 days",
    rationale: "A long trial goes cold before anyone converts",
    provenance: [spanOf(standupId, STANDUP, "I want the trial cut to 7 days")],
    confidence: 0.55,
  });
  const trialLong = await core.proposeNode({
    kind: "decision",
    title: "The trial stays at 14 days",
    rationale: "Activation takes two weekends before the aha moment lands",
    provenance: [spanOf(standupId, STANDUP, "Keep the trial at 14 days")],
    confidence: 0.55,
  });
  await core.proposeNode({
    kind: "question",
    prompt: "The team split on trial length: 7 days or 14 days. Which one holds?",
    relatesTo: [trialShort.id, trialLong.id],
    provenance: [
      spanOf(standupId, STANDUP, "We did not settle it. Parking it for the growth review"),
    ],
    confidence: 0.6,
  });

  // -- the entities the room keeps talking about.
  const editor = await core.proposeNode({
    kind: "entity",
    name: "The editor",
    description: "The core editing surface, works offline",
    provenance: [
      spanOf(standupId, STANDUP, "keep working offline"),
      spanOf(reviewId, REVIEW, "If the editor freezes when wifi drops"),
    ],
    confidence: 0.85,
  });
  const usage = await core.proposeNode({
    kind: "entity",
    name: "Usage billing",
    description: "Metered usage with overage handling, still open",
    provenance: [spanOf(reviewId, REVIEW, "Half our months we blow past the included usage")],
    confidence: 0.7,
  });
  await core.proposeNode({
    kind: "entity",
    name: "Payment dunning",
    description: "The nightly retry for failed plan charges",
    provenance: [
      spanOf(standupId, STANDUP, "failed-payment retries fired four times in an hour last night"),
      spanOf(
        pricingId,
        PRICING_CALL,
        "Annual plans that fail the card retry should pause the workspace",
      ),
    ],
    confidence: 0.75,
  });

  // -- open questions the room left behind, each pointing at its exact line
  //    and at the node an answer would settle, so the loop's promote is felt.
  await core.proposeNode({
    kind: "question",
    prompt: "Overage handling: a hard cap or a clear charge? The team left it open.",
    relatesTo: [usage.id],
    provenance: [
      spanOf(
        reviewId,
        REVIEW,
        "we want either a hard cap or a clear charge, the team has not agreed which",
      ),
    ],
    confidence: 0.65,
  });
  await core.proposeNode({
    kind: "question",
    prompt: "Show teammate presence in the editor, or is that too surveillance-y?",
    relatesTo: [editor.id],
    provenance: [spanOf(reviewId, REVIEW, "The team wants to see who else is viewing a doc")],
    confidence: 0.6,
  });
}
