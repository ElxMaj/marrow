import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { type SeedDoc, estimateTokens, runBenchmark, seedBenchmarkBrain } from "./benchmark.js";
import { createConceptEmbedding } from "./demo.js";
import { Marrow } from "./marrow.js";
import { Store } from "./store.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";
const here = dirname(fileURLToPath(import.meta.url));

// realistic room texts: the raw dump an agent would otherwise swallow is much
// larger than the two compact nodes a task actually needs. That gap is the
// measured token-savings claim, so the corpus has to look like a real room, not
// a one-liner.
const docs: SeedDoc[] = [
  {
    source: "interviews/pfc-gdynia.md",
    text: "Front desk interview. There are three people on the desk across a shift and they all share one login on the same terminal, so the password gets written on a post-it stuck to the monitor and anyone walking past can read it. Nobody can tell who actually did what, which matters when a refund is wrong. We talked about per-person accounts but onboarding a seasonal worker takes too long. We decided magic links, no shared passwords: each person gets a one-time link to their own session, nothing is written down, and the audit log finally shows a real name.",
    entity: "magic link auth",
    decisionTitle: "Auth uses magic links",
    decisionRationale: "shared terminal, passwords on post-its",
  },
  {
    source: "standups/sessions.md",
    text: "Standup, security thread. Because the desk terminal is shared and people wander off mid-shift to help a customer, a session that lives forever is a real risk: the next person inherits an open, authenticated screen. We went back and forth on whether to rely on the OS lock screen, but that is off by default on these machines. We agreed sessions expire after 8 hours so a shift boundary always resets them, and the terminal locks after 15 minutes idle so a quick walk-away does not leave an open session for someone else to use.",
    entity: "session lifetime",
    decisionTitle: "Sessions expire after 8 hours",
    decisionRationale: "shared terminal, walk-away risk",
  },
  {
    source: "notes/billing.md",
    text: "Billing notes. The payment provider redelivers webhooks on its own retry schedule whenever it does not get a fast 200 back, so during an incident last month the same charge event reached us twice and a customer was double-charged. Support had to refund it by hand. We looked at storing a processed-events table versus trusting the provider's dedupe header, which is not always present. We decided billing webhooks retry with backoff and are idempotent by event id, so a redelivery of an event we have already seen is a no-op.",
    entity: "billing webhooks",
    decisionTitle: "Billing webhooks retry with backoff",
    decisionRationale: "provider redelivery caused duplicate charges",
  },
];

let store: Store;
let core: Marrow;
let admin: pg.Pool;

beforeAll(() => {
  execFileSync("node", [join(here, "..", "scripts", "migrate.mjs")], {
    env: { ...process.env, DATABASE_URL },
    stdio: "ignore",
  });
  store = new Store(DATABASE_URL);
  core = new Marrow(store, undefined, createConceptEmbedding());
  admin = new pg.Pool({ connectionString: DATABASE_URL });
});

afterAll(async () => {
  await store.close();
  await admin.end();
});

beforeEach(async () => {
  await admin.query(
    "truncate provenance, embedding, entity, decision, question, goal restart identity cascade",
  );
});

describe("benchmark", () => {
  it("estimates tokens deterministically", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("returns the RIGHT task-scoped slice for each question, not the whole graph", async () => {
    await seedBenchmarkBrain(core, docs);
    // 3 docs -> 6 nodes (entity + decision each). a k=2 slice must contain the
    // on-topic doc's nodes and EXCLUDE the other two topics, or it is not scoped.
    const onTopic = await core.search("magic link auth", 2);
    const blob = JSON.stringify(onTopic);
    expect(onTopic.length).toBeLessThanOrEqual(2); // a slice, not all 6 nodes
    expect(blob).toMatch(/magic|auth/i); // the asked-about topic is present
    expect(blob).not.toMatch(/billing|webhook|session/i); // other topics excluded

    const billing = await core.search("billing webhooks", 2);
    const billingBlob = JSON.stringify(billing);
    expect(billingBlob).toMatch(/billing|webhook/i);
    expect(billingBlob).not.toMatch(/magic|session/i);
  });

  it("task-scoped retrieval beats a raw dump, reproducibly", async () => {
    await seedBenchmarkBrain(core, docs);
    const input = {
      corpusTexts: docs.map((d) => d.text),
      questions: docs.map((d) => d.entity),
      k: 2,
    };

    const first = await runBenchmark(core, input);
    expect(first.ratio).toBeGreaterThan(1); // measured, not projected
    expect(first.marrow.questions).toHaveLength(docs.length);
    expect(first.marrow.questions.every((q) => q.tokens > 0 && q.results > 0)).toBe(true);
    // the slice is genuinely smaller than the graph: scoping, not just a smaller dump.
    expect(first.marrow.questions.every((q) => q.results <= 2)).toBe(true);

    const second = await runBenchmark(core, input);
    expect(second.baseline.tokens).toBe(first.baseline.tokens); // reproducible token counts
    expect(second.marrow.questions.map((q) => q.tokens)).toEqual(
      first.marrow.questions.map((q) => q.tokens),
    );
  });
});
