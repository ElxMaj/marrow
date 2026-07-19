import { type Decision, type Question } from "@marrowhq/shared";

import { type Distilled } from "./distill.js";
import { type Marrow, type TraceResult } from "./marrow.js";
import { type Store } from "./store.js";
import {
  type EmbeddingProvider,
  type EmbeddingResult,
  type ModelProvider,
} from "./providers/types.js";

// PR-14: the whole thing, end to end, on one slice. Composes the engine that
// already exists; adds no new features. The demo distills deterministically so
// it runs from a clean clone with no API key; with a real provider configured,
// the same pipeline runs on real input.

/** The hero-slice interview, inlined so `marrow demo` ships self-contained in
 *  the published package (no fixture file to resolve at runtime). The landing
 *  page quotes these lines verbatim and the demo seed re-ingests this exact
 *  text, so `npx marrow demo`, the hosted demo and the launch site tell one
 *  story (landing/check-ids.mjs holds that contract). Edit with care. */
export const DEMO_INTERVIEW = `# interview: acme design partner launch call, 2026-05-12

[00:11:02] maya: Launch is Monday. The trial is the last call we have not made.
[00:11:09] partner: We ran a card wall last quarter. Signups dropped forty percent overnight, and the ones who stayed churned anyway.
[00:11:18] jonas: And every support ticket in week one was the card form. We cannot spend launch week on billing edge cases.
[00:11:27] maya: Then the wall comes down. Free trial, no card until they convert.
[00:11:36] partner: That is the version I can sell internally. Our champions can start it the day they find it.
[00:11:42] jonas: What about annual billing? Finance put it on the pilot deck.
[00:11:48] maya: Annual billing needs its own call with finance. Not this week.
[00:11:55] jonas: Noted. Parking annual billing as open, trial scope is decided.
`;

/** A deterministic stand-in for the model: it distills the known interview into
 *  the free-trial decision and the entities, each with a real span. One entity
 *  (free trial) is covered by the decision; the other (annual billing) is
 *  not, so gap detection raises it as the open question the hero leaves behind. */
export function createDemoModel(): ModelProvider {
  // Returns verbatim quotes; the engine locates each one in the interview text,
  // the same quote-based provenance a real model uses.
  const extraction = JSON.stringify({
    entities: [
      { name: "free trial", quote: "Free trial" },
      { name: "annual billing", quote: "annual billing" },
    ],
    decisions: [
      {
        title: "Free trial, no card upfront",
        rationale:
          "A card wall cuts signups and floods week-one support; the card question waits until they convert",
        quote: "Free trial, no card until they convert",
      },
    ],
  });
  return { model: "marrow-demo", complete: () => Promise.resolve(extraction) };
}

export function createDemoEmbedding(profile?: { model: string; dim: number }): EmbeddingProvider {
  const dim = profile?.dim ?? 8;
  const model = profile?.model ?? "marrow-demo-emb";
  return {
    model,
    embed: (texts: string[]): Promise<EmbeddingResult> => {
      const vectors = texts.map((t) => {
        const v = new Array<number>(dim).fill(0);
        for (let i = 0; i < t.length; i += 1) {
          const idx = i % dim;
          v[idx] = (v[idx] ?? 0) + t.charCodeAt(i) / 255;
        }
        return v;
      });
      return Promise.resolve({ vectors, model, dim });
    },
  };
}

// A small lexicon of product concepts, one per dimension. A word counts toward a
// concept when it equals or extends a concept stem (passwordless -> password ->
// auth), so synonyms that share no characters still land in the same dimension.
const CONCEPTS: string[][] = [
  [
    "auth",
    "login",
    "logon",
    "signin",
    "sign",
    "passwordless",
    "password",
    "magic",
    "link",
    "credential",
    "sso",
    "oauth",
  ],
  ["session", "expire", "expiry", "idle", "timeout", "lock", "logout", "lifetime", "ttl"],
  [
    "billing",
    "invoice",
    "payment",
    "pay",
    "charge",
    "webhook",
    "subscription",
    "retry",
    "backoff",
    "idempotent",
    "dunning",
  ],
  ["search", "retrieval", "query", "embedding", "vector", "rank", "relevance", "semantic"],
  ["notification", "email", "alert", "notify", "digest", "reminder"],
  ["export", "csv", "download", "async", "poll", "spreadsheet"],
  ["onboarding", "signup", "activation", "walkthrough", "checklist", "serve"],
  ["permission", "role", "admin", "access", "rbac", "invite", "seat", "viewer", "editor"],
  ["offline", "mobile", "sync", "conflict", "device", "writer"],
  ["retention", "purge", "backup", "restore", "archive", "recoverable"],
  ["deploy", "release", "rollback", "canary", "flag", "rollout"],
  ["pricing", "plan", "tier", "trial", "discount", "upgrade", "card"],
];

const stem = (word: string): string => word.replace(/s$/, "");

/**
 * A deterministic, dependency-free embedding that captures coarse TOPICAL
 * similarity: it maps text onto the fixed concept lexicon above, so paraphrases
 * (passwordless ~ magic link) land in the same dimension and cosine distance
 * reflects shared meaning, not shared characters. It is enough to exercise and
 * prove semantic retrieval offline (demo, benchmark, tests) with no API key; it
 * is NOT a substitute for a real embedding model in production.
 */
export function createConceptEmbedding(): EmbeddingProvider {
  const conceptStems = CONCEPTS.map((words) => words.map(stem));
  const dim = CONCEPTS.length + 1; // +1 bias dim so no vector is ever all-zero
  const matches = (token: string, conceptStem: string): boolean =>
    token === conceptStem || (conceptStem.length >= 4 && token.startsWith(conceptStem));
  return {
    model: "marrow-concept-emb",
    embed: (texts: string[]): Promise<EmbeddingResult> => {
      const vectors = texts.map((text) => {
        const v = new Array<number>(dim).fill(0);
        v[dim - 1] = 0.05; // constant bias keeps the vector norm non-zero
        const tokens = text.toLowerCase().match(/[a-z]+/g) ?? [];
        for (const raw of tokens) {
          const token = stem(raw);
          conceptStems.forEach((stems, c) => {
            if (stems.some((s) => matches(token, s))) v[c] = (v[c] ?? 0) + 1;
          });
        }
        return v;
      });
      return Promise.resolve({ vectors, model: "marrow-concept-emb", dim });
    },
  };
}

export interface DemoResult {
  decisionId: string;
  decision: Decision;
  trace: TraceResult;
  answer: Distilled[];
  openQuestions: Question[];
}

/** The evidence source label every demo write carries. The brain guard uses it
 *  to tell a fresh database, a demo re-run, and a real brain apart. */
export const DEMO_SOURCE = "interviews/design-partner.md";

export type DemoBrainCheck =
  | { ok: true }
  | { ok: false; reason: "has-real-evidence"; otherCount: number }
  | { ok: false; reason: "demo-already-ran" };

/**
 * The demo writes fictional product facts, and evidence is append-only: there
 * is no undo. So the demo refuses to write into a brain that holds anything
 * real, and refuses to duplicate itself into a brain it already ran in, unless
 * the caller forces it. An empty database is always fine.
 */
export async function checkDemoBrain(store: Store): Promise<DemoBrainCheck> {
  const { total, other } = await store.evidenceCounts(DEMO_SOURCE);
  if (total === 0) return { ok: true };
  if (other > 0) return { ok: false, reason: "has-real-evidence", otherCount: other };
  return { ok: false, reason: "demo-already-ran" };
}

/**
 * The scripted slice: ingest the interview, distill it, surface a question, the
 * developer answers (the only path to decided), and the free-trial decision
 * becomes decided with provenance back to the interview span.
 */
export async function runDemo(core: Marrow, interview: string): Promise<DemoResult> {
  const { nodes } = await core.ingestAndDistill({
    text: interview,
    source: DEMO_SOURCE,
  });

  const decision = nodes.find((n): n is Decision => n.kind === "decision");
  if (!decision) throw new Error("demo: distillation did not produce the launch-trial decision");

  // The loop surfaces a question; answering it is the only thing that promotes
  // a node to decided.
  const question = await core.proposeNode({
    kind: "question",
    prompt: "Confirm: is the no-card free trial the decided launch scope?",
    relatesTo: [decision.id],
    provenance: decision.provenance,
  });
  await core.answer(question.id, "Yes, free trial, no card until they convert");

  const decided = await core.getDecision(decision.id);
  if (!decided) throw new Error("demo: the decision vanished after promotion");

  return {
    decisionId: decision.id,
    decision: decided,
    trace: await core.traceToSource(decision.id),
    answer: await core.search("free trial", 5),
    openQuestions: await core.getOpenQuestions(),
  };
}
