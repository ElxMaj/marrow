import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Store, createStore, type EdgeDraft } from "./store.js";

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
    "truncate catch_events, verification, provenance, embedding, edge, entity, decision, question, goal restart identity cascade",
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

  it("rejects a provenance span that falls outside its evidence text", async () => {
    // no fact without a real quote: a span past the end renders as a blank or
    // truncated quote, so the store refuses it on every insert path.
    const text = "ten chars!";
    const ev = await store.insertEvidence({ text, source: "room/short.md" });
    const draft = (span: { start: number; end: number }) => ({
      name: "broken quote",
      status: "open" as const,
      confidence: { value: 0.5, source: "model" as const },
      provenance: [{ evidenceId: ev.id, ...span }],
    });
    await expect(store.insertEntity(draft({ start: 0, end: 500 }))).rejects.toThrow(
      /outside evidence/,
    );
    // negative starts are refused upstream by the draft schema; still an error.
    await expect(store.insertEntity(draft({ start: -2, end: 4 }))).rejects.toThrow();
    await expect(store.insertEntity(draft({ start: 4, end: 4 }))).rejects.toThrow(
      /outside evidence/,
    );
    // the boundary itself is fine: the full text is a real quote.
    const good = await store.insertEntity(draft({ start: 0, end: text.length }));
    expect(good.provenance).toHaveLength(1);
    // attaching to an existing node goes through the same choke point.
    await expect(
      store.addProvenance(good.id, "entity", [{ evidenceId: ev.id, start: 2, end: 999 }]),
    ).rejects.toThrow(/outside evidence/);
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

  it("promoteToDecided stamps verified_at; a proposed node carries none", async () => {
    const ev = await store.insertEvidence({ text: "auth notes here", source: "room/fresh.md" });
    const dec = await store.insertDecision({
      title: "use passkeys",
      rationale: "phishing resistance",
      constraint: false,
      status: "open",
      confidence: { value: 0.6, source: "model" },
      provenance: [{ evidenceId: ev.id, start: 0, end: 4 }],
    });
    expect((await store.getDecision(dec.id))?.verifiedAt).toBeUndefined();
    expect((await store.getDecision(dec.id))?.expiresAt).toBeUndefined();

    await store.promoteToDecided(dec.id, "decision", { evidenceId: ev.id, start: 0, end: 4 });

    const after = await store.getDecision(dec.id);
    expect(after?.status).toBe("decided");
    expect(after?.verifiedAt).toBeDefined();
    // no TTL configured, so a promoted fact does not carry an expiry
    expect(after?.expiresAt).toBeUndefined();
  });

  it("records skeptic verdicts append-only and returns the latest", async () => {
    const ev = await store.insertEvidence({ text: "auth notes here", source: "room/v.md" });
    const dec = await store.insertDecision({
      title: "use passkeys",
      rationale: "",
      constraint: false,
      status: "open",
      confidence: { value: 0.6, source: "model" },
      provenance: [{ evidenceId: ev.id, start: 0, end: 4 }],
    });
    await store.insertVerification({
      nodeId: dec.id,
      nodeKind: "decision",
      verdict: "flagged",
      reasons: ["single_source"],
    });
    await store.insertVerification({
      nodeId: dec.id,
      nodeKind: "decision",
      verdict: "survived",
      reasons: [],
    });
    const latest = await store.latestVerification(dec.id);
    expect(latest?.verdict).toBe("survived");
    expect(latest?.reasons).toEqual([]);
    // the node itself is untouched by a verdict
    expect((await store.getDecision(dec.id))?.status).toBe("open");
    expect(await store.latestVerification("dec_missing")).toBeUndefined();
  });
});

describe("Store edges (the knowledge graph)", () => {
  // small seeders: every distilled node needs an evidence span, so make one per
  // node. spans are tiny (the note text is always longer than 3 chars).
  async function ent(name: string) {
    const ev = await store.insertEvidence({ text: `${name} note`, source: "room/x.md" });
    return store.insertEntity({
      name,
      status: "open",
      confidence: { value: 0.6, source: "model" },
      provenance: [{ evidenceId: ev.id, start: 0, end: 3 }],
    });
  }
  async function dec(title: string) {
    const ev = await store.insertEvidence({ text: `${title} note`, source: "room/x.md" });
    return store.insertDecision({
      title,
      rationale: "because",
      constraint: false,
      status: "decided",
      confidence: { value: 1, source: "human" },
      provenance: [{ evidenceId: ev.id, start: 0, end: 3 }],
    });
  }

  it("insertEdge is idempotent on (from, to, relation)", async () => {
    const a = await ent("Auth");
    const d = await dec("Use passkeys");
    const draft: EdgeDraft = {
      fromId: a.id,
      fromKind: "entity",
      toId: d.id,
      toKind: "decision",
      relation: "concerns",
      confidence: 0.8,
      source: "rule",
    };
    await store.insertEdge(draft);
    await store.insertEdge(draft); // a re-distill must not duplicate the same link
    const edges = await store.edgesFor(a.id);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.relation).toBe("concerns");
    expect(edges[0]?.fromId).toBe(a.id);
    expect(edges[0]?.toId).toBe(d.id);
    expect(edges[0]?.source).toBe("rule");
    expect(edges[0]?.confidence).toBeCloseTo(0.8);
  });

  it("neighbors walks one and two hops and respects maxHops", async () => {
    const a = await ent("Auth");
    const d1 = await dec("Use passkeys");
    const d2 = await dec("Drop SMS OTP");
    // a -concerns-> d1 -refines-> d2, so from a: d1 is 1 hop, d2 is 2 hops.
    await store.insertEdge({
      fromId: a.id,
      fromKind: "entity",
      toId: d1.id,
      toKind: "decision",
      relation: "concerns",
      confidence: 0.9,
      source: "rule",
    });
    await store.insertEdge({
      fromId: d1.id,
      fromKind: "decision",
      toId: d2.id,
      toKind: "decision",
      relation: "refines",
      confidence: 0.7,
      source: "model",
    });

    const oneHop = await store.neighbors([a.id], ["entity"], 1);
    expect(oneHop.map((n) => n.id)).toContain(d1.id);
    expect(oneHop.map((n) => n.id)).not.toContain(d2.id);

    const twoHop = await store.neighbors([a.id], ["entity"], 2);
    expect(twoHop.map((n) => n.id)).toEqual(expect.arrayContaining([d1.id, d2.id]));
    expect(twoHop.find((n) => n.id === d1.id)?.depth).toBe(1);
    expect(twoHop.find((n) => n.id === d2.id)?.depth).toBe(2);
    // seeds are never returned as their own neighbors
    expect(twoHop.map((n) => n.id)).not.toContain(a.id);
  });

  it("neighbors walks edges in both directions", async () => {
    const a = await ent("Auth");
    const d = await dec("Use passkeys");
    // edge points d -> a, but from seed a we still reach d by walking the to side.
    await store.insertEdge({
      fromId: d.id,
      fromKind: "decision",
      toId: a.id,
      toKind: "entity",
      relation: "concerns",
      confidence: 0.9,
      source: "rule",
    });
    const nb = await store.neighbors([a.id], ["entity"], 1);
    expect(nb.map((n) => n.id)).toContain(d.id);
  });

  it("neighbors returns nothing for empty seeds", async () => {
    expect(await store.neighbors([], [])).toEqual([]);
  });

  it("degree and degrees count edges touching a node, including zero", async () => {
    const a = await ent("Auth");
    const d1 = await dec("Use passkeys");
    const d2 = await dec("Drop SMS OTP");
    await store.insertEdge({
      fromId: a.id,
      fromKind: "entity",
      toId: d1.id,
      toKind: "decision",
      relation: "concerns",
      confidence: 0.9,
      source: "rule",
    });
    await store.insertEdge({
      fromId: a.id,
      fromKind: "entity",
      toId: d2.id,
      toKind: "decision",
      relation: "concerns",
      confidence: 0.9,
      source: "rule",
    });
    expect(await store.degree(a.id)).toBe(2);
    expect(await store.degree(d1.id)).toBe(1);
    const map = await store.degrees([a.id, d1.id, "ent_missing"]);
    expect(map.get(a.id)).toBe(2);
    expect(map.get(d1.id)).toBe(1);
    expect(map.get("ent_missing")).toBe(0);
  });

  it("listEdges returns a bounded slice of the graph", async () => {
    const a = await ent("Auth");
    const d1 = await dec("Use passkeys");
    const d2 = await dec("Drop SMS OTP");
    await store.insertEdge({
      fromId: a.id,
      fromKind: "entity",
      toId: d1.id,
      toKind: "decision",
      relation: "concerns",
      confidence: 0.9,
      source: "rule",
    });
    await store.insertEdge({
      fromId: a.id,
      fromKind: "entity",
      toId: d2.id,
      toKind: "decision",
      relation: "concerns",
      confidence: 0.9,
      source: "rule",
    });
    expect(await store.listEdges()).toHaveLength(2);
    expect(await store.listEdges(1)).toHaveLength(1);
  });

  it("listIndex lists every node with its degree, hubs first, titles only", async () => {
    const hub = await ent("Auth");
    const d1 = await dec("Use passkeys");
    const d2 = await dec("Drop SMS OTP");
    await store.insertEdge({
      fromId: hub.id,
      fromKind: "entity",
      toId: d1.id,
      toKind: "decision",
      relation: "concerns",
      confidence: 0.6,
      source: "rule",
    });
    await store.insertEdge({
      fromId: hub.id,
      fromKind: "entity",
      toId: d2.id,
      toKind: "decision",
      relation: "concerns",
      confidence: 0.6,
      source: "rule",
    });

    const idx = await store.listIndex();
    expect(idx).toHaveLength(3);
    expect(idx[0]?.id).toBe(hub.id); // most connected first
    expect(idx[0]?.degree).toBe(2);
    expect(idx[0]?.title).toBe("Auth");
    expect(idx.map((e) => e.kind).sort()).toEqual(["decision", "decision", "entity"]);
    expect(await store.listIndex(1)).toHaveLength(1); // bounded
  });
});

describe("undistilled evidence backlog", () => {
  it("reports evidence that neither provenance nor a successful distill run accounts for", async () => {
    const ev = await store.insertEvidence({
      text: "backlog raw session notes",
      source: "session/backlog.md",
    });
    const { count, oldestCreatedAt } = await store.countUndistilledEvidence();
    expect(count).toBeGreaterThanOrEqual(1);
    expect(oldestCreatedAt).toBeDefined();
    const pending = await store.undistilledEvidence(10_000);
    expect(pending.map((row) => row.id)).toContain(ev.id);
    // newest first: a fresh session drains before ancient leftovers.
    expect(pending[0]?.id).toBe(ev.id);
  });

  it("a provenance span settles the row out of the backlog", async () => {
    const ev = await store.insertEvidence({
      text: "cited raw notes",
      source: "session/cited.md",
    });
    await store.insertEntity({
      name: "cited entity",
      status: "open",
      confidence: { value: 0.5, source: "model" },
      provenance: [{ evidenceId: ev.id, start: 0, end: 5 }],
    });
    const pending = await store.undistilledEvidence(10_000);
    expect(pending.map((row) => row.id)).not.toContain(ev.id);
  });

  it("a successful distill run settles a distilled-to-zero-nodes row out of the backlog", async () => {
    const ev = await store.insertEvidence({
      text: "smalltalk with nothing durable in it",
      source: "session/zero.md",
    });
    // the shape traced() records for a distill that created no nodes: without
    // this run row the backlog could not tell "never distilled" apart from
    // "distilled to zero nodes", since evidence itself is immutable.
    await admin.query(
      `insert into run (id, kind, status, label, latency_ms, metadata, created_at)
       values ($1, 'distill', 'ok', $2, 1, $3::jsonb, now())`,
      [`run-test-${ev.id}`, ev.source, JSON.stringify({ evidenceId: ev.id, newNodes: 0 })],
    );
    const pending = await store.undistilledEvidence(10_000);
    expect(pending.map((row) => row.id)).not.toContain(ev.id);
  });

  it("a failed distill run keeps the row in the backlog for the next drain", async () => {
    const ev = await store.insertEvidence({
      text: "the model fell over on this one",
      source: "session/failed.md",
    });
    await admin.query(
      `insert into run (id, kind, status, label, latency_ms, error, metadata, created_at)
       values ($1, 'distill', 'error', $2, 1, 'model timeout', $3::jsonb, now())`,
      [`run-test-fail-${ev.id}`, ev.source, JSON.stringify({ evidenceId: ev.id })],
    );
    const pending = await store.undistilledEvidence(10_000);
    expect(pending.map((row) => row.id)).toContain(ev.id);
  });
});

describe("secret scrub at the evidence choke point", () => {
  it("insertEvidence replaces credential-shaped spans before the append", async () => {
    const ev = await store.insertEvidence({
      text: "the deploy notes leaked AKIAIOSFODNN7EXAMPLE in the standup",
      source: "standups/leak.md",
    });
    expect(ev.text).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(ev.text).toContain("[redacted:aws-access-key]");
    // and the stored row matches what was returned: the secret never landed.
    const stored = await store.getEvidence(ev.id);
    expect(stored?.text).toBe(ev.text);
    expect((await store.searchEvidence("AKIAIOSFODNN7EXAMPLE")).length).toBe(0);
  });

  it("covers the connector-sync path, which inserts evidence directly", async () => {
    const ev = await store.insertEvidence({
      text: "slack export: token ghp_abcDEF1234567890abcDEF1234567890 was shared in #eng",
      source: "slack:C1:42",
    });
    expect(ev.text).toContain("[redacted:github-token]");
    expect(ev.text).toContain("#eng");
  });
});

describe("dedupe delete completeness", () => {
  const confidence = { value: 0.6, source: "model" as const };

  async function seedDupePair() {
    const ev = await store.insertEvidence({
      text: "the billing portal handles invoices and refunds",
      source: "room/dupe.md",
    });
    const prov = [{ evidenceId: ev.id, start: 0, end: 10 }];
    const canonical = await store.insertEntity({
      name: "billing portal",
      status: "open",
      confidence,
      provenance: prov,
    });
    const dupe = await store.insertEntity({
      name: "Billing Portal",
      status: "open",
      confidence,
      provenance: prov,
    });
    const decision = await store.insertDecision({
      title: "invoices are immutable after send",
      rationale: "",
      constraint: true,
      status: "open",
      confidence,
      provenance: prov,
    });
    return { canonical, dupe, decision };
  }

  it("re-points the duplicate's edges and verifications to the canonical node", async () => {
    const { canonical, dupe, decision } = await seedDupePair();
    await store.insertEdge({
      fromId: dupe.id,
      fromKind: "entity",
      toId: decision.id,
      toKind: "decision",
      relation: "concerns",
      confidence: 0.9,
      source: "rule",
    });
    await store.insertVerification({
      nodeId: dupe.id,
      nodeKind: "entity",
      verdict: "survived",
      reasons: [],
    });

    await store.deleteEntity(dupe.id, canonical.id);

    const edges = await store.edgesFor(canonical.id);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.fromId).toBe(canonical.id);
    expect(edges[0]?.toId).toBe(decision.id);
    expect(await store.edgesFor(dupe.id)).toHaveLength(0);
    expect((await store.latestVerification(canonical.id))?.verdict).toBe("survived");
  });

  it("re-points a goal's entity_id on merge so deleting a goal-referenced entity does not trip the FK", async () => {
    const { canonical, dupe } = await seedDupePair();
    const ev = await store.insertEvidence({ text: "the goal source", source: "room/goal.md" });
    const prov = [{ evidenceId: ev.id, start: 0, end: 3 }];
    const merged = await store.insertGoal({
      title: "make billing self-serve",
      goalType: "product",
      entityId: dupe.id,
      status: "open",
      confidence,
      provenance: prov,
    });

    // must not throw a foreign-key violation; the goal follows the merge.
    await store.deleteEntity(dupe.id, canonical.id);
    expect((await store.getGoal(merged.id))?.entityId).toBe(canonical.id);

    // a plain removal (no canonical) detaches the goal rather than FK-aborting.
    const orphaned = await store.insertGoal({
      title: "retire the old portal",
      goalType: "product",
      entityId: canonical.id,
      status: "open",
      confidence,
      provenance: prov,
    });
    await store.deleteEntity(canonical.id);
    expect((await store.getGoal(orphaned.id))?.entityId).toBeUndefined();
  });

  it("drops edges that would duplicate an existing canonical edge, and self-loops", async () => {
    const { canonical, dupe, decision } = await seedDupePair();
    // the canonical node already has the same relation to the decision...
    await store.insertEdge({
      fromId: canonical.id,
      fromKind: "entity",
      toId: decision.id,
      toKind: "decision",
      relation: "concerns",
      confidence: 0.9,
      source: "rule",
    });
    // ...the dupe carries a copy of it, plus an edge to the canonical itself,
    // which would become a self-loop after re-pointing.
    await store.insertEdge({
      fromId: dupe.id,
      fromKind: "entity",
      toId: decision.id,
      toKind: "decision",
      relation: "concerns",
      confidence: 0.5,
      source: "rule",
    });
    await store.insertEdge({
      fromId: dupe.id,
      fromKind: "entity",
      toId: canonical.id,
      toKind: "entity",
      relation: "relates_to",
      confidence: 0.5,
      source: "rule",
    });

    await store.deleteEntity(dupe.id, canonical.id);

    const edges = await store.edgesFor(canonical.id);
    expect(edges).toHaveLength(1); // the original edge, no dup, no self-loop
    expect(edges[0]?.confidence).toBe(0.9);
    expect(edges.every((e) => e.fromId !== e.toId)).toBe(true);
  });

  it("re-points edges arriving AT the duplicate (to_id side) as well", async () => {
    const { canonical, dupe, decision } = await seedDupePair();
    await store.insertEdge({
      fromId: decision.id,
      fromKind: "decision",
      toId: dupe.id,
      toKind: "entity",
      relation: "serves",
      confidence: 0.8,
      source: "rule",
    });

    await store.deleteEntity(dupe.id, canonical.id);

    const edges = await store.edgesFor(canonical.id);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.toId).toBe(canonical.id);
  });

  it("without a canonical, removes the node's edges and verifications so nothing dangles", async () => {
    const { canonical, dupe, decision } = await seedDupePair();
    void canonical;
    await store.insertEdge({
      fromId: dupe.id,
      fromKind: "entity",
      toId: decision.id,
      toKind: "decision",
      relation: "concerns",
      confidence: 0.9,
      source: "rule",
    });
    await store.insertVerification({
      nodeId: dupe.id,
      nodeKind: "entity",
      verdict: "flagged",
      reasons: ["single_source"],
    });

    await store.deleteEntity(dupe.id);

    expect(await store.edgesFor(dupe.id)).toHaveLength(0);
    expect(await store.latestVerification(dupe.id)).toBeUndefined();
    const all = await store.listEdges(1000);
    expect(all.every((e) => e.fromId !== dupe.id && e.toId !== dupe.id)).toBe(true);
  });
});

describe("retract (the human-only correction)", () => {
  const modelConf = { value: 0.6, source: "model" as const };

  it("sets retracted with human confidence and links the reason as provenance", async () => {
    const ev = await store.insertEvidence({ text: "hallucinated fact here", source: "room/h.md" });
    const dec = await store.insertDecision({
      title: "We use a message queue",
      rationale: "",
      constraint: false,
      status: "open",
      confidence: modelConf,
      provenance: [{ evidenceId: ev.id, start: 0, end: 11 }],
    });
    const reason = await store.insertEvidence({
      text: "never actually said in the room",
      source: `retractions/${dec.id}`,
    });
    await store.retract(dec.id, "decision", { evidenceId: reason.id, start: 0, end: 10 });

    const after = await store.getDecision(dec.id);
    expect(after?.status).toBe("retracted");
    expect(after?.confidence.source).toBe("human");
    expect(after?.provenance.some((p) => p.evidenceId === reason.id)).toBe(true);
    // content survives: nothing is erased.
    expect(after?.title).toBe("We use a message queue");
  });

  it("retracted nodes vanish from keyword search and semantic hydration", async () => {
    const ev = await store.insertEvidence({ text: "retractable topic notes", source: "room/r.md" });
    const dec = await store.insertDecision({
      title: "retractable widget policy",
      rationale: "",
      constraint: false,
      status: "open",
      confidence: modelConf,
      provenance: [{ evidenceId: ev.id, start: 0, end: 11 }],
    });
    expect((await store.searchNodes("retractable widget")).map((n) => n.id)).toContain(dec.id);

    const reason = await store.insertEvidence({
      text: "false memory",
      source: `retractions/${dec.id}`,
    });
    await store.retract(dec.id, "decision", { evidenceId: reason.id, start: 0, end: 5 });

    expect((await store.searchNodes("retractable widget")).map((n) => n.id)).not.toContain(dec.id);
    // still inspectable by id: invalidation of retrieval, not erasure.
    expect((await store.getDecision(dec.id))?.title).toBe("retractable widget policy");
  });
});
