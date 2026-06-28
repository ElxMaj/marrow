import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Store, createStore } from "./store.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";
const here = dirname(fileURLToPath(import.meta.url));

let store: Store;
let admin: pg.Pool;

beforeAll(() => {
  // apply migrations through the exact runner CI uses, so the test exercises the
  // real schema path rather than a bespoke one.
  execFileSync("node", [join(here, "..", "scripts", "migrate.mjs")], {
    env: { ...process.env, DATABASE_URL },
    stdio: "ignore",
  });
  store = new Store(DATABASE_URL);
  admin = new pg.Pool({ connectionString: DATABASE_URL });
});

afterAll(async () => {
  await store.close();
  await admin.end();
});

beforeEach(async () => {
  // test-harness reset only. note evidence is NOT truncated: it is append only
  // even here, which is why every test inserts the evidence it needs. the Store
  // exposes no evidence update or delete path at all.
  await admin.query(
    "truncate catch_events, provenance, embedding, entity, decision, question, goal restart identity cascade",
  );
});

describe("Store", () => {
  it("fails loud when DATABASE_URL is missing", () => {
    expect(() => createStore("")).toThrow(
      "DATABASE_URL is not set. Point it at your Postgres and retry.",
    );
  });

  it("evidence cannot be updated or deleted through the store", () => {
    // @ts-expect-error there is no update method on evidence
    expect(store.updateEvidence).toBeUndefined();
    // @ts-expect-error there is no delete method on evidence
    expect(store.deleteEvidence).toBeUndefined();
  });

  it("stores evidence verbatim and returns a shared Evidence type", async () => {
    const text = "we share one login at the desk, the password ends up on a post-it";
    const ev = await store.insertEvidence({ text, source: "interviews/pfc-gdynia.md" });
    expect(ev.kind).toBe("evidence");
    const round = await store.getEvidence(ev.id);
    expect(round?.text).toBe(text);
    expect(round?.source).toBe("interviews/pfc-gdynia.md");
  });

  it("searches evidence text literally, newest first, and bounded by limit", async () => {
    const marker = `evidence-search-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const first = await store.insertEvidence({
      text: `first ${marker} raw note`,
      source: "room/first.md",
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await store.insertEvidence({
      text: `second ${marker} raw note`,
      source: "room/second.md",
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const third = await store.insertEvidence({
      text: `third ${marker} raw note`,
      source: "room/third.md",
    });

    const limited = await store.searchEvidence(marker, 2);
    expect(limited.map((ev) => ev.id)).toEqual([third.id, second.id]);
    expect(limited.map((ev) => ev.id)).not.toContain(first.id);

    const literalNeedle = `${marker}%_literal`;
    const exact = await store.insertEvidence({
      text: `exact ${literalNeedle}`,
      source: "room/exact.md",
    });
    const wildcardDecoy = await store.insertEvidence({
      text: `decoy ${marker}abc-literal`,
      source: "room/decoy.md",
    });

    const literalHits = await store.searchEvidence(literalNeedle, 10);
    expect(literalHits.map((ev) => ev.id)).toContain(exact.id);
    expect(literalHits.map((ev) => ev.id)).not.toContain(wildcardDecoy.id);
  });

  it("a decision requires provenance", async () => {
    // @ts-expect-error intentionally missing required fields including provenance
    await expect(store.insertDecision({})).rejects.toThrow();
  });

  it("a decision with provenance to missing evidence is rejected by the FK", async () => {
    await expect(
      store.insertDecision({
        title: "auth uses magic links",
        rationale: "shared desk terminal",
        constraint: false,
        status: "open",
        confidence: { value: 0.7, source: "model" },
        provenance: [{ evidenceId: "ev_does_not_exist", start: 0, end: 5 }],
      }),
    ).rejects.toThrow();
  });

  it("rolls back transactional node writes when a provenance insert fails", async () => {
    const title = "rollback half-written decision";
    const ev = await store.insertEvidence({ text: "room notes", source: "rollback.md" });

    await expect(
      store.insertDecision({
        title,
        rationale: "",
        constraint: false,
        status: "open",
        confidence: { value: 0.6, source: "model" },
        provenance: [
          { evidenceId: ev.id, start: 0, end: 4 },
          { evidenceId: "ev_missing_for_rollback", start: 0, end: 4 },
        ],
      }),
    ).rejects.toThrow();

    const decisionRows = await admin.query<{ n: number }>(
      "select count(*)::int n from decision where title = $1",
      [title],
    );
    expect(decisionRows.rows[0]?.n).toBe(0);
  });

  it("inserts a decision with provenance and returns status + provenance", async () => {
    const ev = await store.insertEvidence({
      text: "we decided magic links, no passwords",
      source: "interviews/pfc-gdynia.md",
    });
    const d = await store.insertDecision({
      title: "Auth uses magic links, no shared passwords",
      rationale: "desk staff shared one terminal and wrote passwords on sticky notes",
      constraint: false,
      status: "open",
      confidence: { value: 0.8, source: "model" },
      provenance: [{ evidenceId: ev.id, start: 0, end: 12 }],
    });
    expect(d.status).toBe("open");
    expect(d.provenance[0]?.evidenceId).toBe(ev.id);
    const round = await store.getDecision(d.id);
    expect(round?.title).toBe(d.title);
    expect(round?.provenance).toHaveLength(1);
  });

  it("embedding dim mismatch throws before touching the database", async () => {
    await expect(
      store.insertEmbedding({ nodeId: "x", model: "m", dim: 3, vector: [0.1, 0.2] }),
    ).rejects.toThrow(/dim/i);
  });

  it("stores its model and dim, and cosine search returns the nearest node", async () => {
    const ev = await store.insertEvidence({ text: "room notes", source: "a" });
    const prov = [{ evidenceId: ev.id, start: 0, end: 4 }];
    const confidence = { value: 0.6, source: "model" as const };
    const near = await store.insertEntity({
      name: "magic link auth",
      status: "open",
      confidence,
      provenance: prov,
    });
    const far = await store.insertEntity({
      name: "billing webhooks",
      status: "open",
      confidence,
      provenance: prov,
    });
    await store.insertEmbedding({
      nodeId: near.id,
      nodeKind: "entity",
      model: "test",
      dim: 3,
      vector: [1, 0, 0],
    });
    await store.insertEmbedding({
      nodeId: far.id,
      nodeKind: "entity",
      model: "test",
      dim: 3,
      vector: [0, 1, 0],
    });

    const results = await store.nearestNodes([0.9, 0.1, 0], 1);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe(near.id);
  });

  it("rejects an embedding from a different model or dim (a provider switch)", async () => {
    const ev = await store.insertEvidence({ text: "room notes", source: "a" });
    const prov = [{ evidenceId: ev.id, start: 0, end: 4 }];
    const confidence = { value: 0.5, source: "model" as const };
    const a = await store.insertEntity({ name: "a", status: "open", confidence, provenance: prov });
    const b = await store.insertEntity({ name: "b", status: "open", confidence, provenance: prov });
    await store.insertEmbedding({
      nodeId: a.id,
      nodeKind: "entity",
      model: "emb-a",
      dim: 3,
      vector: [1, 0, 0],
    });
    await expect(
      store.insertEmbedding({
        nodeId: b.id,
        nodeKind: "entity",
        model: "emb-b",
        dim: 4,
        vector: [1, 0, 0, 0],
      }),
    ).rejects.toThrow(/provider mismatch|re-embed/i);
  });

  it("provenance is idempotent: the identical span is never duplicated", async () => {
    const ev = await store.insertEvidence({ text: "room notes here", source: "a" });
    const prov = [{ evidenceId: ev.id, start: 0, end: 4 }];
    const e = await store.insertEntity({
      name: "thing",
      status: "open",
      confidence: { value: 0.5, source: "model" },
      provenance: prov,
    });
    // adding the same (node, evidence, span) link again is a no-op.
    await store.addProvenance(e.id, "entity", prov);
    await store.addProvenance(e.id, "entity", prov);
    const round = await store.getEntity(e.id);
    expect(round?.provenance).toHaveLength(1);
  });

  it("records catch events and lists them by decision", async () => {
    const ev = await store.insertEvidence({ text: "decided", source: "eval" });
    const decision = await store.insertDecision({
      title: "no passwords",
      rationale: "",
      constraint: true,
      status: "decided",
      confidence: { value: 1, source: "human" },
      provenance: [{ evidenceId: ev.id, start: 0, end: 7 }],
    });
    const id = await store.insertCatchEvent({
      eventType: "catch_surfaced",
      decisionId: decision.id,
      repoPath: "/repo",
      diffSpan: { path: "src/auth.ts", lineStart: 7, lineEnd: 8, hunkText: "password" },
      trigger: "test",
      synthetic: true,
      modelUsed: "test-model",
      confidence: 0.8,
    });
    const events = await store.listCatchEvents({ decisionId: decision.id });
    expect(id).toBeGreaterThan(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id,
      event_type: "catch_surfaced",
      question_id: null,
      decision_id: decision.id,
      repo_path: "/repo",
      diff_span: { path: "src/auth.ts", lineStart: 7, lineEnd: 8, hunkText: "password" },
      trigger: "test",
      synthetic: true,
      model_used: "test-model",
      confidence: 0.8,
    });
    expect(typeof events[0]?.created_at).toBe("string");
    expect(events[0]?.created_at).toMatch(/T/);
  });

  it("fails loud if a catch event insert returns no id", async () => {
    type Query = (sql: string, values?: readonly unknown[]) => Promise<{ rows: unknown[] }>;
    const testStore = store as unknown as { pool: { query: Query } };
    const original = testStore.pool.query;
    testStore.pool.query = async (sql, values) => {
      if (sql.includes("insert into catch_events")) return { rows: [] };
      return original.call(testStore.pool, sql, values);
    };

    try {
      await expect(
        store.insertCatchEvent({ eventType: "catch_surfaced", trigger: "test" }),
      ).rejects.toThrow(/catch event insert failed/i);
    } finally {
      testStore.pool.query = original;
    }
  });

  it("marks only non-decided decisions contested", async () => {
    const ev = await store.insertEvidence({ text: "room decided auth", source: "eval" });
    const provenance = [{ evidenceId: ev.id, start: 0, end: 4 }];
    const open = await store.insertDecision({
      title: "auth needs review",
      rationale: "",
      constraint: false,
      status: "open",
      confidence: { value: 0.6, source: "model" },
      provenance,
    });
    const decided = await store.insertDecision({
      title: "auth stays magic-link only",
      rationale: "",
      constraint: true,
      status: "decided",
      confidence: { value: 1, source: "human" },
      provenance,
    });

    await store.markDecisionContested(open.id);
    await store.markDecisionContested(decided.id);

    expect((await store.getDecision(open.id))?.status).toBe("contested");
    expect((await store.getDecision(decided.id))?.status).toBe("decided");
  });

  it("detects an existing question relating two nodes regardless of question status", async () => {
    const ev = await store.insertEvidence({ text: "auth and billing", source: "relations.md" });
    const provenance = [{ evidenceId: ev.id, start: 0, end: 4 }];
    const auth = await store.insertDecision({
      title: "auth uses magic links",
      rationale: "",
      constraint: false,
      status: "open",
      confidence: { value: 0.6, source: "model" },
      provenance,
    });
    const billing = await store.insertDecision({
      title: "billing stays flat",
      rationale: "",
      constraint: false,
      status: "open",
      confidence: { value: 0.6, source: "model" },
      provenance,
    });
    const unrelated = await store.insertDecision({
      title: "reports need export",
      rationale: "",
      constraint: false,
      status: "open",
      confidence: { value: 0.6, source: "model" },
      provenance,
    });
    const question = await store.insertQuestion({
      prompt: "which auth/billing decision holds?",
      relatesTo: [auth.id, billing.id],
      status: "open",
      confidence: { value: 0.5, source: "model" },
      provenance,
    });

    expect(await store.hasQuestionRelating(auth.id, billing.id)).toBe(true);
    expect(await store.hasQuestionRelating(auth.id, unrelated.id)).toBe(false);

    await store.resolveQuestion(question.id);
    expect(await store.hasQuestionRelating(auth.id, billing.id)).toBe(true);
  });

  it("aggregates catch metrics and can exclude synthetic events", async () => {
    const ev = await store.insertEvidence({ text: "decided", source: "eval" });
    const decision = await store.insertDecision({
      title: "no passwords",
      rationale: "",
      constraint: true,
      status: "decided",
      confidence: { value: 1, source: "human" },
      provenance: [{ evidenceId: ev.id, start: 0, end: 7 }],
    });
    await store.insertCatchEvent({
      eventType: "catch_surfaced",
      decisionId: decision.id,
      trigger: "test",
    });
    await store.insertCatchEvent({
      eventType: "catch_acted_on",
      decisionId: decision.id,
      trigger: "test",
    });
    await store.insertCatchEvent({
      eventType: "catch_dismissed",
      decisionId: decision.id,
      trigger: "test",
    });
    await store.insertCatchEvent({
      eventType: "catch_surfaced",
      decisionId: decision.id,
      trigger: "test",
      synthetic: true,
    });

    expect(await store.getCatchMetrics()).toMatchObject({
      surfaced: 2,
      actedOn: 1,
      dismissed: 1,
      precision: 0.5,
      dismissRate: 0.5,
    });
    expect(await store.getCatchMetrics({ excludeSynthetic: true })).toMatchObject({
      surfaced: 1,
      actedOn: 1,
      dismissed: 1,
      precision: 0.5,
      dismissRate: 1,
    });
  });

  it("dismisses a question and records the reason as provenance", async () => {
    const ev = await store.insertEvidence({ text: "decided", source: "eval" });
    const decision = await store.insertDecision({
      title: "no passwords",
      rationale: "",
      constraint: true,
      status: "decided",
      confidence: { value: 1, source: "human" },
      provenance: [{ evidenceId: ev.id, start: 0, end: 7 }],
    });
    const question = await store.insertQuestion({
      prompt: "drift?",
      relatesTo: [decision.id],
      status: "open",
      confidence: { value: 0.5, source: "model" },
      provenance: [{ evidenceId: ev.id, start: 0, end: 7 }],
    });
    const reasonEv = await store.insertEvidence({
      text: "not a contradiction",
      source: "dismissal",
    });
    await store.dismissQuestion(question.id, { evidenceId: reasonEv.id, start: 0, end: 19 });
    const round = await store.getQuestion(question.id);
    expect(round?.status).toBe("dismissed");
    expect(round?.provenance).toHaveLength(2);
  });
});

// goals are the fifth distilled node kind: a target/outcome the room committed
// to, carried with the same status + confidence + provenance discipline as every
// other distilled node, plus a goalType and an optional entity link.
describe("Store goals", () => {
  const modelConf = { value: 0.6, source: "model" as const };

  it("inserts a goal with goalType, entityId and provenance, and round-trips it", async () => {
    const ev = await store.insertEvidence({
      text: "users must finish onboarding in one sitting",
      source: "interviews/x.md",
    });
    const entity = await store.insertEntity({
      name: "onboarding",
      status: "open",
      confidence: modelConf,
      provenance: [{ evidenceId: ev.id, start: 0, end: 5 }],
    });
    const goal = await store.insertGoal({
      title: "Users finish onboarding in one sitting",
      description: "no drop-off mid-flow",
      goalType: "user",
      entityId: entity.id,
      status: "open",
      confidence: { value: 0.7, source: "model" },
      provenance: [{ evidenceId: ev.id, start: 0, end: 12 }],
    });
    expect(goal.id.startsWith("goal_")).toBe(true);
    expect(goal.kind).toBe("goal");
    const round = await store.getGoal(goal.id);
    expect(round?.title).toBe("Users finish onboarding in one sitting");
    expect(round?.goalType).toBe("user");
    expect(round?.entityId).toBe(entity.id);
    expect(round?.description).toBe("no drop-off mid-flow");
    expect(round?.provenance).toHaveLength(1);
    expect(round?.provenance[0]?.evidenceId).toBe(ev.id);
  });

  it("a goal requires provenance", async () => {
    // @ts-expect-error intentionally missing required fields including provenance
    await expect(store.insertGoal({})).rejects.toThrow();
  });

  it("getNode dispatches a goal_ id to getGoal", async () => {
    const ev = await store.insertEvidence({ text: "ship the dashboard", source: "x" });
    const goal = await store.insertGoal({
      title: "Ship the dashboard",
      goalType: "product",
      status: "open",
      confidence: modelConf,
      provenance: [{ evidenceId: ev.id, start: 0, end: 4 }],
    });
    const node = await store.getNode(goal.id);
    expect(node?.kind).toBe("goal");
    expect(node?.id).toBe(goal.id);
  });

  it("searchNodes finds a goal by title", async () => {
    const ev = await store.insertEvidence({ text: "reduce churn this quarter", source: "x" });
    await store.insertGoal({
      title: "Reduce churn this quarter",
      goalType: "product",
      status: "open",
      confidence: modelConf,
      provenance: [{ evidenceId: ev.id, start: 0, end: 6 }],
    });
    const hits = await store.searchNodes("churn");
    expect(hits.some((n) => n.kind === "goal" && n.title.includes("churn"))).toBe(true);
  });

  it("nearestNodes ranks a goal among the node kinds", async () => {
    const ev = await store.insertEvidence({ text: "growth goal", source: "x" });
    const goal = await store.insertGoal({
      title: "double activation",
      goalType: "product",
      status: "open",
      confidence: modelConf,
      provenance: [{ evidenceId: ev.id, start: 0, end: 6 }],
    });
    await store.insertEmbedding({
      nodeId: goal.id,
      nodeKind: "goal",
      model: "test",
      dim: 3,
      vector: [1, 0, 0],
    });
    const results = await store.nearestNodes([0.9, 0.1, 0], 1);
    expect(results[0]?.id).toBe(goal.id);
  });

  it("getNodesForEvidence includes a goal that cites the evidence", async () => {
    const ev = await store.insertEvidence({ text: "raise NPS above forty", source: "x" });
    const goal = await store.insertGoal({
      title: "Raise NPS above forty",
      goalType: "product",
      status: "open",
      confidence: modelConf,
      provenance: [{ evidenceId: ev.id, start: 0, end: 5 }],
    });
    const nodes = await store.getNodesForEvidence(ev.id);
    expect(nodes.some((n) => n.id === goal.id && n.kind === "goal")).toBe(true);
  });

  it("listGoals filters by status, goalType and entityId; getOpenGoals returns only open goals", async () => {
    const ev = await store.insertEvidence({ text: "goals galore", source: "x" });
    const prov = [{ evidenceId: ev.id, start: 0, end: 5 }];
    const entity = await store.insertEntity({
      name: "billing",
      status: "open",
      confidence: modelConf,
      provenance: prov,
    });
    const openProduct = await store.insertGoal({
      title: "p-open",
      goalType: "product",
      entityId: entity.id,
      status: "open",
      confidence: modelConf,
      provenance: prov,
    });
    const decidedUser = await store.insertGoal({
      title: "u-decided",
      goalType: "user",
      status: "decided",
      confidence: { value: 1, source: "human" },
      provenance: prov,
    });

    expect((await store.listGoals({ goalType: "product" })).map((g) => g.id)).toEqual([
      openProduct.id,
    ]);
    expect((await store.listGoals({ entityId: entity.id })).map((g) => g.id)).toEqual([
      openProduct.id,
    ]);
    expect((await store.listGoals({ status: "decided" })).map((g) => g.id)).toEqual([
      decidedUser.id,
    ]);
    expect((await store.getOpenGoals()).map((g) => g.id)).toEqual([openProduct.id]);
  });
});
