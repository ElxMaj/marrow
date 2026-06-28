import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Marrow } from "./marrow.js";
import {
  type EmbeddingProvider,
  type EmbeddingResult,
  type ModelProvider,
} from "./providers/types.js";
import { Store } from "./store.js";
import { decisionSignals, goalDriftSignal, ruleDriftSignal } from "./link.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";
const here = dirname(fileURLToPath(import.meta.url));

const span = (text: string, phrase: string) => {
  const start = text.indexOf(phrase);
  if (start < 0) throw new Error(`phrase not found in text: ${phrase}`);
  return { start, end: start + phrase.length };
};

const entityExtraction = (text: string, name: string) => ({
  entities: [{ name, ...span(text, name) }],
  decisions: [],
  questions: [],
});

const decisionExtraction = (text: string, title: string, rationale: string) => ({
  entities: [],
  decisions: [{ title, rationale, constraint: false, ...span(text, title) }],
  questions: [],
});

const goalExtraction = (
  text: string,
  title: string,
  description: string,
  goalType: "product" | "user" = "product",
) => ({
  entities: [],
  decisions: [],
  goals: [{ title, description, goalType, ...span(text, title) }],
  questions: [],
});

// returns the next scripted extraction per complete() call.
class ScriptedModel implements ModelProvider {
  readonly model = "scripted";
  private queue: unknown[] = [];
  push(extraction: unknown): this {
    this.queue.push(extraction);
    return this;
  }
  reset(): void {
    this.queue = [];
  }
  complete(): Promise<string> {
    const next = this.queue.shift() ?? { entities: [], decisions: [], questions: [] };
    return Promise.resolve(JSON.stringify(next));
  }
}

class FakeEmbedding implements EmbeddingProvider {
  readonly model = "fake-emb";
  embed(texts: string[]): Promise<EmbeddingResult> {
    const dim = 8;
    const vectors = texts.map((t) => {
      const v = new Array<number>(dim).fill(0);
      for (let i = 0; i < t.length; i += 1) {
        const idx = i % dim;
        v[idx] = (v[idx] ?? 0) + t.charCodeAt(i) / 255;
      }
      return v;
    });
    return Promise.resolve({ vectors, model: this.model, dim });
  }
}

let store: Store;
let core: Marrow;
let model: ScriptedModel;
let admin: pg.Pool;

beforeAll(() => {
  execFileSync("node", [join(here, "..", "scripts", "migrate.mjs")], {
    env: { ...process.env, DATABASE_URL },
    stdio: "ignore",
  });
  store = new Store(DATABASE_URL);
  model = new ScriptedModel();
  core = new Marrow(store, model, new FakeEmbedding());
  admin = new pg.Pool({ connectionString: DATABASE_URL });
});

afterAll(async () => {
  await store.close();
  await admin.end();
});

beforeEach(async () => {
  model.reset();
  await admin.query(
    "truncate provenance, embedding, entity, decision, question, goal restart identity cascade",
  );
});

describe("link, merge, conflict and gap", () => {
  it("one concept becomes one node across two sources by normalized name, keeping both spans", async () => {
    const a = "Magic Link Auth is the chosen login method";
    const b = "the magic link auth login flow still needs work";
    model.push(entityExtraction(a, "Magic Link Auth"));
    model.push(entityExtraction(b, "magic link auth"));

    await core.ingestAndDistill({ text: a, source: "interviews/a.md" });
    await core.ingestAndDistill({ text: b, source: "interviews/b.md" });

    const entities = await core.findEntities("magic link");
    expect(entities).toHaveLength(1);
    expect(entities[0]?.name).toBe("Magic Link Auth");
    expect(entities[0]?.provenance.length).toBe(2); // merge never drops provenance

    const trace = await core.traceToSource(entities[0]?.id ?? "");
    expect(trace.spans.map((s) => s.source).sort()).toEqual(["interviews/a.md", "interviews/b.md"]);
    expect(trace.spans.map((s) => s.spanText).sort()).toEqual([
      "Magic Link Auth",
      "magic link auth",
    ]);
  });

  it("a contradiction raises a question and never overwrites the decided node", async () => {
    const seed = await store.insertEvidence({
      text: "auth uses passwords today",
      source: "legacy",
    });
    const decided = await store.insertDecision({
      title: "auth uses passwords",
      rationale: "legacy shared login",
      constraint: false,
      status: "decided",
      confidence: { value: 1, source: "human" },
      provenance: [{ evidenceId: seed.id, start: 0, end: 19 }],
    });

    const text = "we decided magic links, no passwords from now on";
    model.push(decisionExtraction(text, "magic links, no passwords", ""));
    await core.ingestAndDistill({ text, source: "interviews/c.md" });

    const questions = await core.getOpenQuestions();
    expect(questions.some((q) => /conflict|contradict/i.test(q.prompt))).toBe(true);

    const after = await core.getDecision(decided.id);
    expect(after?.status).toBe("decided"); // the human decides, the merge does not
    expect(after?.status).not.toBe("superseded");
  });

  it("an entity nobody decided anything about raises a gap question", async () => {
    const text = "the billing webhooks integration came up in passing";
    model.push(entityExtraction(text, "billing webhooks"));
    const { nodes } = await core.ingestAndDistill({ text, source: "standups/d.md" });

    const entity = nodes.find((n) => n.kind === "entity");
    expect(entity).toBeDefined();
    const questions = await core.getOpenQuestions();
    expect(
      questions.some(
        (q) =>
          entity !== undefined &&
          (q.relatesTo ?? []).includes(entity.id) &&
          /never decided|specify/i.test(q.prompt),
      ),
    ).toBe(true);
  });

  it("two contradicting goals raise a conflict question, never auto-resolving", async () => {
    const a = "we want full offline support for every user";
    model.push(goalExtraction(a, "full offline support", "the app must work without a network"));
    await core.ingestAndDistill({ text: a, source: "goals/a.md" });

    const b = "actually no offline support, online only from now on";
    model.push(goalExtraction(b, "no offline support", "online only"));
    await core.ingestAndDistill({ text: b, source: "goals/b.md" });

    const questions = await core.getOpenQuestions();
    const conflict = questions.find((q) => /goal conflict/i.test(q.prompt));
    expect(conflict).toBeDefined();
    expect((conflict?.relatesTo ?? []).length).toBe(2);
    // both goals stay open: a conflict only asks, it never picks a winner.
    const goals = await store.listGoals();
    expect(goals.every((g) => g.status === "open")).toBe(true);
  });

  it("a goal attached to no feature raises one gap question, deduped", async () => {
    const text = "the team set sub-second cold start as a goal for the product";
    model.push(goalExtraction(text, "sub-second cold start", "startup must be fast"));
    const { evidenceId, nodes } = await core.ingestAndDistill({ text, source: "goals/c.md" });

    const goal = nodes.find((n) => n.kind === "goal");
    expect(goal).toBeDefined();
    if (goal?.kind !== "goal") return;
    expect(goal.entityId).toBeUndefined();

    const gaps = (await core.getOpenQuestions()).filter(
      (q) => (q.relatesTo ?? []).includes(goal.id) && /feature or product/i.test(q.prompt),
    );
    expect(gaps).toHaveLength(1); // exactly one, never noisy

    // re-linking the same evidence must not raise a second gap (deduped).
    await core.linkAndMerge(evidenceId);
    const after = (await core.getOpenQuestions()).filter(
      (q) => (q.relatesTo ?? []).includes(goal.id) && /feature or product/i.test(q.prompt),
    );
    expect(after).toHaveLength(1);
  });
});

describe("drift signal rules", () => {
  it("extracts negated and affirmed terms from a decision", () => {
    const signals = decisionSignals({
      title: "no passwords, use magic links",
      rationale: "we decided passwordless auth",
    });
    expect([...signals.negated]).toContain("passwords");
    expect([...signals.affirmed]).toContain("magic");
    expect([...signals.salient]).toContain("passwordless");
  });

  it("flags code that affirms a negated term", () => {
    const hit = ruleDriftSignal("const passwordHash = hash(password);", {
      title: "no passwords, magic links only",
      rationale: "",
    });
    expect(hit).toBeDefined();
    expect(hit?.kind).toBe("negated");
    expect(hit?.term).toBe("passwords");
  });

  it("does not flag code that is consistent with the decision", () => {
    const hit = ruleDriftSignal("const magicLink = generateLink(email);", {
      title: "no passwords, magic links only",
      rationale: "",
    });
    expect(hit).toBeUndefined();
  });

  it("returns a lower-confidence hit for affirmed terms that appear", () => {
    const hit = ruleDriftSignal("const magicLink = generateLink(email);", {
      title: "use magic links for auth",
      rationale: "",
    });
    expect(hit).toBeDefined();
    expect(hit?.kind).toBe("affirmed");
    expect(hit?.confidence).toBeLessThan(0.5);
  });

  it("does not treat comma-separated alternatives as negated", () => {
    const signals = decisionSignals({
      title: "no passwords, magic links only",
      rationale: "",
    });
    expect([...signals.negated]).toContain("passwords");
    expect([...signals.negated]).not.toContain("magic");
    expect([...signals.negated]).not.toContain("links");
    expect([...signals.affirmed]).toContain("magic");
  });

  it("goal drift fires on a contradicting hunk, below decision confidence", () => {
    const code = "const passwordHash = hash(password);";
    const goal = { title: "no passwords, magic links only", description: "" };
    const decision = { title: "no passwords, magic links only", rationale: "" };

    const goalHit = goalDriftSignal(code, goal);
    const decisionHit = ruleDriftSignal(code, decision);

    expect(goalHit).toBeDefined();
    expect(goalHit?.kind).toBe("negated");
    expect(goalHit?.term).toBe("passwords");
    expect(decisionHit).toBeDefined();
    // goals are aspirational, not prescriptive: a goal hit must rank below the
    // matching decision hit so the maintenance layer never out-shouts the room.
    expect(goalHit!.confidence).toBeLessThan(decisionHit!.confidence);
  });

  it("goal drift does not fire on code consistent with the goal", () => {
    const hit = goalDriftSignal("const magicLink = generateLink(email);", {
      title: "no passwords, magic links only",
      description: "",
    });
    expect(hit).toBeUndefined();
  });
});
