// The shared product room used by both seeds. No side effects on import: a
// module the demo seed and the console seed both pull widenTheRoom from, so the
// two never drift. The hero interview itself is core's DEMO_INTERVIEW; this adds
// the surrounding standups, reviews and pricing notes as immutable evidence,
// proposes nodes with verbatim-quote spans, promotes some through the answer
// loop, and leaves one conflict open so the picker shows.
import { type Marrow } from "@marrowhq/core";

type RoomSeedCore = Pick<Marrow, "ingest" | "proposeNode" | "answer">;

export const STANDUP = `# Standup 2026-06-02

priya: Soft delete shipped to staging, recoverable for 30 days like we agreed. QA restored a deleted project this morning in two clicks.

priya: The old rule where a delete needed a founder email to reverse is dead, soft delete replaced it.

marco: The open one is dashboard sessions. I want a 12 hour idle timeout, half our users sit on shared screens in open offices and walk away.

priya: Keep sessions until they sign out. People live in the dashboard all day and a re-login mid-task kills the flow.

marco: We did not settle it. Parking it for the security review.

lena: The editor drops every time someone is on hotel wifi and their edits vanish. It has to keep working offline and sync when the connection is back.

lena: Also the failed-payment retries fired four times in an hour last night for the annual plans. The backoff is too tight, someone has to look this week.

marco: Also we settled auth, magic links only, no passwords. Password resets and shared terminals are a constant support and security drain.
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

  // -- auth: a decision that will surface as drift if a prospect's repo still
  //    uses passwords. useful for the "catch in minutes" hosted demo path.
  const auth = await core.proposeNode({
    kind: "decision",
    title: "Auth uses magic links, no passwords",
    rationale: "Password resets and shared terminals are a support and security burden",
    provenance: [spanOf(standupId, STANDUP, "magic links only, no passwords")],
    confidence: 0.75,
  });
  const authQ = await core.proposeNode({
    kind: "question",
    prompt: "Confirm magic-link auth, no passwords, for the public launch.",
    relatesTo: [auth.id],
    provenance: auth.provenance,
    confidence: 0.7,
  });
  await core.answer(authQ.id, "Confirmed. Magic links only. No local passwords in the codebase.");

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

  // -- dashboard sessions: the room split, two open decisions, one conflict the
  //    human has to settle. This is the picker the demo exists to show.
  const idleExpiry = await core.proposeNode({
    kind: "decision",
    title: "Dashboard sessions expire after 12 hours idle",
    rationale: "Shared screens in open offices, walk-away risk",
    provenance: [spanOf(standupId, STANDUP, "I want a 12 hour idle timeout")],
    confidence: 0.55,
  });
  const persistSession = await core.proposeNode({
    kind: "decision",
    title: "Dashboard sessions persist until the user signs out",
    rationale: "People live in the dashboard all day, a mid-task re-login kills flow",
    provenance: [spanOf(standupId, STANDUP, "Keep sessions until they sign out")],
    confidence: 0.55,
  });
  await core.proposeNode({
    kind: "question",
    prompt:
      "The team split on dashboard sessions: a 12 hour idle expiry or persist until signout. Which one holds?",
    relatesTo: [idleExpiry.id, persistSession.id],
    provenance: [
      spanOf(standupId, STANDUP, "We did not settle it. Parking it for the security review"),
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
