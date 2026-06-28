import { type Decision, type Question } from "@marrowhq/shared";

import { type Distilled } from "./distill.js";
import { type Marrow, type TraceResult } from "./marrow.js";
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
 *  text, so `npx marrow demo`, the hosted demo and marrowhq.com tell one
 *  story (landing/check-ids.mjs holds that contract). Edit with care. */
export const DEMO_INTERVIEW = `# interview: acme design partner advisory, 2026-05-12

[00:18:04] dana: Tell me about the last time the product scared you.
[00:18:12] partner: A teammate hard-deleted our staging project last quarter. One click, confirmed, and it was gone.
[00:18:23] dana: There was no way back?
[00:18:28] partner: Nothing. It purged on confirm. Support could not recover it and we lost a week rebuilding.
[00:18:37] partner: A hard delete on the wrong project is a support fire. Give us a window to undo it.
[00:18:45] dana: Then that's it. Soft delete, 30 days, then purge.
[00:18:51] sam: Agreed. Recoverable for a month, then it is really gone.
[00:18:58] dana: Does 30 days cover your audit window?
[00:19:05] partner: More than enough. A Friday-afternoon mistake just has to be survivable.
[00:19:12] sam: And what purge means for backups still needs its own call. Not today.
[00:19:18] dana: Noted. Park it as open.
`;

/** A deterministic stand-in for the model: it distills the known interview into
 *  the soft-delete decision and the entities, each with a real span. One entity
 *  (soft delete) is covered by the decision; the other (backup retention) is
 *  not, so gap detection raises it as the open question the hero leaves behind. */
export function createDemoModel(): ModelProvider {
  // Returns verbatim quotes; the engine locates each one in the interview text,
  // the same quote-based provenance a real model uses.
  const extraction = JSON.stringify({
    entities: [
      { name: "soft delete", quote: "Soft delete" },
      { name: "backup retention", quote: "backups" },
    ],
    decisions: [
      {
        title: "Soft delete for 30 days, then purge",
        rationale:
          "A teammate hard-deleted a project and the team lost a week with no way to undo it",
        quote: "Soft delete, 30 days, then purge",
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

/**
 * The scripted slice: ingest the interview, distill it, surface a question, the
 * developer answers (the only path to decided), and the soft-delete decision
 * becomes decided with provenance back to the interview span.
 */
export async function runDemo(core: Marrow, interview: string): Promise<DemoResult> {
  const { nodes } = await core.ingestAndDistill({
    text: interview,
    source: "interviews/design-partner.md",
  });

  const decision = nodes.find((n): n is Decision => n.kind === "decision");
  if (!decision) throw new Error("demo: distillation did not produce the soft-delete decision");

  // The loop surfaces a question; answering it is the only thing that promotes
  // a node to decided.
  const question = await core.proposeNode({
    kind: "question",
    prompt: "Confirm: is soft delete with a 30 day window the decided approach?",
    relatesTo: [decision.id],
    provenance: decision.provenance,
  });
  await core.answer(question.id, "Yes, soft delete with a 30 day window, then purge");

  const decided = await core.getDecision(decision.id);
  if (!decided) throw new Error("demo: the decision vanished after promotion");

  return {
    decisionId: decision.id,
    decision: decided,
    trace: await core.traceToSource(decision.id),
    answer: await core.search("soft delete", 5),
    openQuestions: await core.getOpenQuestions(),
  };
}
