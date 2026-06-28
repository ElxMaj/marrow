import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type EmbeddingProvider,
  type EmbeddingResult,
  Marrow,
  type ModelProvider,
  Store,
} from "@marrowhq/core";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { answerBatch, answerQuestion, authorGoal, getGoals, getState, trace } from "./api";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";
const here = dirname(fileURLToPath(import.meta.url));
const coreMigrate = join(here, "..", "..", "core", "scripts", "migrate.mjs");
const transcript = "the magic link auth flow still needs love before launch";

class FakeModel implements ModelProvider {
  readonly model = "fake-model";
  constructor(private readonly baseText: string) {}
  complete(): Promise<string> {
    const text = this.baseText.toLowerCase();
    // return different entities based on content to create multiple gap questions
    if (text.includes("pricing") || text.includes("seat")) {
      const start = text.indexOf("pricing");
      return Promise.resolve(
        JSON.stringify({
          entities: [{ name: "pricing model", start, end: start + 13 }],
        }),
      );
    }
    if (text.includes("payment") || text.includes("retry")) {
      const start = text.indexOf("payment");
      return Promise.resolve(
        JSON.stringify({
          entities: [{ name: "payment retry policy", start, end: start + 20 }],
        }),
      );
    }
    const start = this.baseText.indexOf("magic link auth");
    return Promise.resolve(
      JSON.stringify({ entities: [{ name: "magic link auth", start, end: start + 15 }] }),
    );
  }
}
class FakeEmbedding implements EmbeddingProvider {
  readonly model = "fake-emb";
  embed(texts: string[]): Promise<EmbeddingResult> {
    return Promise.resolve({ vectors: texts.map(() => [0, 0, 0, 0]), model: this.model, dim: 4 });
  }
}

let store: Store;
let core: Marrow;
let admin: pg.Pool;

beforeAll(() => {
  execFileSync("node", [coreMigrate], { env: { ...process.env, DATABASE_URL }, stdio: "ignore" });
  store = new Store(DATABASE_URL);
  core = new Marrow(store, new FakeModel(transcript), new FakeEmbedding());
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

describe("web api", () => {
  it("getState returns the graph with status and provenance on every node", async () => {
    await core.ingestAndDistill({ text: transcript, source: "interviews/pfc-gdynia.md" });
    const state = await getState(core);
    expect(state.entities.length).toBeGreaterThan(0);
    expect(state.entities[0]?.status).toBeDefined();
    expect(state.entities[0]?.provenance.length).toBeGreaterThan(0);
    expect(state.questions.length).toBeGreaterThan(0);
  });

  it("answering through the web promotes the node, exactly like the cli", async () => {
    await core.ingestAndDistill({ text: transcript, source: "x" });
    const before = await getState(core);
    const gap = before.questions.find((q) => /never decided|specify/i.test(q.prompt));
    if (!gap) throw new Error("expected a gap question");
    const relatedId = gap.relatesTo?.[0];
    if (!relatedId) throw new Error("expected relatesTo");

    await answerQuestion(core, gap.id, "yes, magic links only");

    const node = await core.getNode(relatedId);
    expect(node?.status).toBe("decided");
    expect(node?.confidence.source).toBe("human");

    const after = await getState(core);
    expect(after.questions.find((q) => q.id === gap.id)).toBeUndefined();
  });

  it("trace returns the exact source span and label", async () => {
    await core.ingestAndDistill({ text: transcript, source: "interviews/pfc-gdynia.md" });
    const state = await getState(core);
    const node = state.entities[0];
    if (!node) throw new Error("expected an entity");
    const result = await trace(core, node.id);
    expect(result.source).toMatch(/pfc-gdynia/);
    expect((result.spanText ?? "").length).toBeGreaterThan(0);
  });

  // Goals are the headline surface: a product team authors goals, the agent
  // proposes goals from the room, and the loop settles the open ones. The web
  // reads them through the Store (a thin window, like catches/runs) and authors
  // them through the same core.authorGoal path the CLI would use.
  it("getGoals returns authored (decided/human) and proposed (open/model) goals with provenance", async () => {
    // a human authors a goal directly -> lands decided, human-confidence
    const authored = await authorGoal(core, {
      title: "users can restore deleted records for 30 days",
      description: "soft delete, not a hard delete, with a visible recovery window",
      goalType: "user",
    });
    expect(authored.status).toBe("decided");

    // the agent proposes a goal from the room -> open, model-confidence
    const ev = await core.ingest({
      text: "we want SOC2 compliance before enterprise sales",
      source: "x",
    });
    await core.proposeNode({
      kind: "goal",
      title: "reach SOC2 compliance",
      goalType: "product",
      provenance: [{ evidenceId: ev, start: 0, end: 10 }],
      confidence: 0.5,
    });

    const goals = await getGoals(store);
    expect(goals.length).toBeGreaterThanOrEqual(2);

    const a = goals.find((g) => g.id === authored.id);
    expect(a?.status).toBe("decided");
    expect(a?.confidence.source).toBe("human");
    expect(a?.goalType).toBe("user");
    expect(a?.provenance.length ?? 0).toBeGreaterThan(0);

    const p = goals.find((g) => g.title === "reach SOC2 compliance");
    expect(p?.status).toBe("open");
    expect(p?.confidence.source).toBe("model");
    expect(p?.goalType).toBe("product");
  });

  it("authorGoal captures the authored text as immutable evidence the goal traces back to", async () => {
    const goal = await authorGoal(core, {
      title: "cut first-run setup to under five minutes",
      goalType: "product",
    });
    expect(goal.status).toBe("decided");
    expect(goal.confidence).toEqual({ value: 1, source: "human" });
    expect(goal.provenance.length).toBeGreaterThan(0);
    // the team's own statement is the provenance: a real evidence span exists.
    const result = await trace(core, goal.id);
    expect((result.spanText ?? "").length).toBeGreaterThan(0);
  });

  it("getGoals resolves the entity a goal serves and filters by goalType", async () => {
    const ev = await core.ingest({
      text: "billing is the feature we keep coming back to",
      source: "x",
    });
    const entity = await core.proposeNode({
      kind: "entity",
      name: "billing",
      provenance: [{ evidenceId: ev, start: 0, end: 7 }],
      confidence: 0.6,
    });
    const served = await authorGoal(core, {
      title: "billing never double-charges a customer",
      goalType: "product",
      entityId: entity.id,
    });
    await authorGoal(core, { title: "a user can self-serve a refund", goalType: "user" });

    const all = await getGoals(store);
    const withEntity = all.find((g) => g.id === served.id);
    expect(withEntity?.entityName).toBe("billing");

    const userGoals = await getGoals(store, { goalType: "user" });
    expect(userGoals.length).toBeGreaterThan(0);
    expect(userGoals.every((g) => g.goalType === "user")).toBe(true);
  });

  it("answerBatch promotes several questions in one call", async () => {
    // create two gap questions directly to ensure we have 2 distinct questions
    const ev1 = await core.ingest({ text: "magic link auth needs work", source: "x" });
    const ev2 = await core.ingest({ text: "payment retry logic needs work", source: "y" });

    const entity1 = await core.proposeNode({
      kind: "entity",
      name: "magic link auth",
      provenance: [{ evidenceId: ev1, start: 0, end: 20 }],
      confidence: 0.7,
    });
    const entity2 = await core.proposeNode({
      kind: "entity",
      name: "payment retry logic",
      provenance: [{ evidenceId: ev2, start: 0, end: 20 }],
      confidence: 0.7,
    });

    await core.proposeNode({
      kind: "question",
      prompt: "specify the magic link auth implementation",
      relatesTo: [entity1.id],
      provenance: [{ evidenceId: ev1, start: 0, end: 20 }],
      confidence: 0.6,
    });
    await core.proposeNode({
      kind: "question",
      prompt: "specify the payment retry logic",
      relatesTo: [entity2.id],
      provenance: [{ evidenceId: ev2, start: 0, end: 20 }],
      confidence: 0.6,
    });

    const before = await getState(core);
    expect(before.questions.length).toBeGreaterThanOrEqual(2);

    const answers = before.questions
      .slice(0, 2)
      .map((q) => ({ questionId: q.id, text: "confirmed" }));
    const result = await answerBatch(core, answers);
    expect(result.promoted.length).toBe(2);

    const after = await getState(core);
    for (const { questionId } of answers) {
      expect(after.questions.find((q) => q.id === questionId)).toBeUndefined();
    }
  });
});
