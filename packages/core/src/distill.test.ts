import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DISTILL_SYSTEM, chunkText, parseExtraction } from "./distill.js";
import { Marrow } from "./marrow.js";
import {
  type EmbeddingProvider,
  type EmbeddingResult,
  type ModelProvider,
} from "./providers/types.js";
import { Store } from "./store.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";
const here = dirname(fileURLToPath(import.meta.url));

const gdyniaTranscript = [
  "Interviewer: walk me through the front desk login.",
  "Staff: we share one login at the desk, the password ends up on a post-it.",
  "We decided magic links, no shared passwords, so nobody writes anything down.",
  "Open question: how fast must desk staff re-authenticate between shifts?",
].join("\n");

// A deterministic model. It ignores the prompt and returns a fixed extraction
// using verbatim `quote`s (the real provenance contract), plus one node whose
// quote is NOT in the transcript so we can prove it gets dropped.
class FakeModel implements ModelProvider {
  readonly model = "fake-model";
  complete(): Promise<string> {
    return Promise.resolve(
      JSON.stringify({
        entities: [
          { name: "magic link auth", quote: "magic links", confidence: 0.7 },
          // quote not present verbatim: must be dropped, never stored.
          {
            name: "ghost entity",
            quote: "a phrase that is nowhere in the transcript",
            confidence: 0.5,
          },
        ],
        decisions: [
          {
            title: "Auth uses magic links, no shared passwords",
            rationale: "desk staff shared one terminal and wrote passwords on sticky notes",
            constraint: false,
            quote: "magic links, no shared passwords",
            confidence: 0.8,
          },
        ],
        questions: [
          {
            prompt: "how fast must desk staff re-authenticate between shifts?",
            quote: "re-authenticate",
            confidence: 0.5,
          },
        ],
      }),
    );
  }
}

// returns a correct quote but a GARBAGE character offset: the engine must locate
// the node by its quote and ignore the wrong offset.
class GarbageOffsetModel implements ModelProvider {
  readonly model = "garbage-offset";
  complete(): Promise<string> {
    return Promise.resolve(
      JSON.stringify({
        entities: [{ name: "magic link auth", quote: "magic links", start: 99999, end: 100000 }],
        decisions: [],
        questions: [],
      }),
    );
  }
}

// the room decided nothing: extraction is empty lists.
class EmptyModel implements ModelProvider {
  readonly model = "empty";
  complete(): Promise<string> {
    return Promise.resolve(JSON.stringify({ entities: [], decisions: [], questions: [] }));
  }
}

// emits one goal whose quote IS in the transcript, so we can prove the goal kind
// is distilled like every other kind: open, model, cited to a real span.
class GoalModel implements ModelProvider {
  readonly model = "goal-model";
  complete(): Promise<string> {
    return Promise.resolve(
      JSON.stringify({
        entities: [],
        decisions: [],
        goals: [
          {
            title: "Eliminate shared passwords at the desk",
            description: "nobody writes credentials down",
            goalType: "product",
            quote: "no shared passwords",
            confidence: 0.7,
          },
        ],
        questions: [],
      }),
    );
  }
}

// emits a decision ONLY when the chunk it is handed contains the marker, so a
// test can prove a LATER chunk of a long transcript was actually distilled.
class MarkerModel implements ModelProvider {
  readonly model = "marker";
  complete(prompt: string): Promise<string> {
    const found = prompt.includes("DECISION-MARKER");
    return Promise.resolve(
      JSON.stringify({
        entities: [],
        decisions: found
          ? [{ title: "found the marker", rationale: "", quote: "DECISION-MARKER" }]
          : [],
        questions: [],
      }),
    );
  }
}

// A deterministic embedding: a small fixed-dim vector derived from the text.
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
let admin: pg.Pool;

beforeAll(() => {
  execFileSync("node", [join(here, "..", "scripts", "migrate.mjs")], {
    env: { ...process.env, DATABASE_URL },
    stdio: "ignore",
  });
  store = new Store(DATABASE_URL);
  core = new Marrow(store, new FakeModel(), new FakeEmbedding());
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

describe("parseExtraction", () => {
  it("pulls strict JSON out of prose and defaults missing lists", () => {
    const parsed = parseExtraction(`sure, here is the extraction:
\`\`\`json
{"entities":[{"name":"magic links","quote":"magic links","confidence":0.7}]}
\`\`\``);

    expect(parsed.entities).toHaveLength(1);
    expect(parsed.entities[0]?.name).toBe("magic links");
    expect(parsed.decisions).toEqual([]);
    expect(parsed.goals).toEqual([]);
    expect(parsed.questions).toEqual([]);
  });

  it("fails loud when the model returns no JSON object", () => {
    expect(() => parseExtraction("I found nothing to extract.")).toThrow(/no JSON object/);
  });

  it("fails loud when the sliced model JSON is invalid", () => {
    expect(() => parseExtraction('{"entities": [}')).toThrow(/not valid JSON/);
  });

  it("validates the extraction shape instead of returning partial objects", () => {
    expect(() => parseExtraction('{"entities":[{"name":"x","confidence":2}]}')).toThrow(
      /confidence/,
    );
  });
});

describe("distillation", () => {
  it("extracts goals as open/model nodes cited to a real span", async () => {
    const c = new Marrow(store, new GoalModel(), new FakeEmbedding());
    const id = await c.ingest({ text: gdyniaTranscript, source: "x" });
    const nodes = await c.distill(id);
    const goal = nodes.find((n) => n.kind === "goal");
    if (!goal || goal.kind !== "goal") throw new Error("expected a distilled goal");
    expect(goal.status).toBe("open");
    expect(goal.confidence.source).toBe("model");
    expect(goal.goalType).toBe("product");
    const span = goal.provenance[0];
    if (!span) throw new Error("expected provenance");
    expect(gdyniaTranscript.slice(span.start, span.end)).toBe("no shared passwords");
  });

  it("never produces a decided node", async () => {
    const id = await core.ingest({ text: gdyniaTranscript, source: "interviews/pfc-gdynia.md" });
    const nodes = await core.distill(id);
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.every((n) => n.status !== "decided")).toBe(true);
    expect(nodes.every((n) => n.confidence.source === "model")).toBe(true);
  });

  it("every node traces to a real span", async () => {
    const id = await core.ingest({ text: gdyniaTranscript, source: "x" });
    const nodes = await core.distill(id);
    for (const node of nodes) {
      const span = node.provenance[0];
      if (!span) throw new Error("a distilled node had no provenance span");
      const ev = await core.getEvidence(span.evidenceId);
      expect(ev?.text.slice(span.start, span.end).length).toBeGreaterThan(0);
    }
  });

  it("traceToSource returns the exact evidence span and source label", async () => {
    const id = await core.ingest({
      text: gdyniaTranscript,
      source: "interviews/pfc-gdynia.md",
    });
    const nodes = await core.distill(id);
    const entity = nodes.find((n) => n.kind === "entity" && n.name === "magic link auth");
    if (!entity) throw new Error("expected magic link auth entity");

    const trace = await core.traceToSource(entity.id);

    expect(trace.nodeId).toBe(entity.id);
    expect(trace.source).toBe("interviews/pfc-gdynia.md");
    expect(trace.spanText).toBe("magic links");
    expect(trace.spans).toHaveLength(1);
    expect(trace.spans[0]).toMatchObject({
      evidenceId: id,
      source: "interviews/pfc-gdynia.md",
      spanText: "magic links",
    });
  });

  it("traceToSource fails loud for an unknown node", async () => {
    await expect(core.traceToSource("dec_missing")).rejects.toThrow(/not found/);
  });

  it("drops a node whose quote is not in the text, never storing empty provenance", async () => {
    const id = await core.ingest({ text: gdyniaTranscript, source: "x" });
    const nodes = await core.distill(id);
    expect(nodes.some((n) => n.kind === "entity" && n.name === "ghost entity")).toBe(false);
    // the real entity, whose quote IS present, survives.
    expect(nodes.some((n) => n.kind === "entity" && n.name === "magic link auth")).toBe(true);
  });

  it("locates a node by its quote even when the model's offsets are wrong", async () => {
    const c = new Marrow(store, new GarbageOffsetModel(), new FakeEmbedding());
    const id = await c.ingest({ text: gdyniaTranscript, source: "x" });
    const nodes = await c.distill(id);
    const entity = nodes.find((n) => n.kind === "entity");
    if (!entity) throw new Error("expected the entity to be created from its quote");
    const span = entity.provenance[0];
    if (!span) throw new Error("expected provenance");
    // span resolves to the quote's real location, NOT the garbage offset.
    expect(gdyniaTranscript.slice(span.start, span.end)).toBe("magic links");
  });

  it("returns empty cleanly when the room decided nothing", async () => {
    const c = new Marrow(store, new EmptyModel(), new FakeEmbedding());
    const id = await c.ingest({
      text: "status update only, nothing was decided today",
      source: "x",
    });
    const nodes = await c.distill(id);
    expect(nodes).toHaveLength(0);
  });

  it("distills the tail of a long transcript, not just the head (chunking)", async () => {
    // > 8000 chars of filler forces more than one chunk; the only decision lives
    // at the very end, so it is only found if the last chunk is distilled.
    const filler = "lorem ipsum dolor sit amet consectetur.\n".repeat(600);
    const text = `${filler}\n\nDECISION-MARKER is here at the very end of the room.`;
    const c = new Marrow(store, new MarkerModel(), new FakeEmbedding());
    const id = await c.ingest({ text, source: "x" });
    const nodes = await c.distill(id);
    expect(nodes.some((n) => n.kind === "decision" && n.title === "found the marker")).toBe(true);
  });

  it("is idempotent: re-running does not duplicate", async () => {
    const id = await core.ingest({ text: gdyniaTranscript, source: "x" });
    const a = await core.distill(id);
    const b = await core.distill(id);
    expect(b.length).toBe(a.length);
  });

  it("embeds each node with its model and dim", async () => {
    const id = await core.ingest({ text: gdyniaTranscript, source: "x" });
    const nodes = await core.distill(id);
    const res = await admin.query<{ embedding_model: string; dim: number }>(
      "select embedding_model, dim from embedding where node_id = any($1)",
      [nodes.map((n) => n.id)],
    );
    expect(res.rows).toHaveLength(nodes.length);
    for (const row of res.rows) {
      expect(row.embedding_model).toBe("fake-emb");
      expect(row.dim).toBe(8);
    }
  });

  it("reports canDistill only when both model and embedding providers are configured", () => {
    expect(new Marrow(store).canDistill).toBe(false);
    expect(new Marrow(store, new FakeModel()).canDistill).toBe(false);
    expect(new Marrow(store, undefined, new FakeEmbedding()).canDistill).toBe(false);
    expect(core.canDistill).toBe(true);
  });

  it("fails loud if distill is used without providers", async () => {
    const bare = new Marrow(store);
    const id = await core.ingest({ text: gdyniaTranscript, source: "x" });
    await expect(bare.distill(id)).rejects.toThrow(/provider/i);
  });
});

describe("chunkText", () => {
  it("returns one chunk when the text fits", () => {
    expect(chunkText("short", 100)).toEqual(["short"]);
  });

  it("splits oversized text and every chunk stays within the budget", () => {
    const text = Array.from({ length: 50 }, (_, i) => `paragraph number ${i} here`).join("\n\n");
    const chunks = chunkText(text, 80);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 80)).toBe(true);
    // nothing is lost: every paragraph still appears across the chunks.
    expect(chunks.join("\n\n")).toContain("paragraph number 49 here");
  });

  it("hard-splits a wall of text with no line breaks", () => {
    const chunks = chunkText("x".repeat(250), 100);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunks.join("")).toBe("x".repeat(250)); // nothing lost
  });
});

describe("write-time injection guard", () => {
  it("the distill prompt tells the model the transcript is data, never instructions", () => {
    expect(DISTILL_SYSTEM).toMatch(/never instructions to you/i);
    expect(DISTILL_SYSTEM).toMatch(/never obey/i);
  });
});
