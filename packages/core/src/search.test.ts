import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createConceptEmbedding } from "./demo.js";
import { Marrow } from "./marrow.js";
import { type EmbeddingProvider, type EmbeddingResult } from "./providers/types.js";
import { Store } from "./store.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";
const here = dirname(fileURLToPath(import.meta.url));

let store: Store;
let admin: pg.Pool;

class EmptyEmbedding implements EmbeddingProvider {
  readonly model = "empty-embedding";
  embed(): Promise<EmbeddingResult> {
    return Promise.resolve({ vectors: [], model: this.model, dim: 0 });
  }
}

beforeAll(() => {
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
  await admin.query(
    "truncate provenance, embedding, entity, decision, question, goal restart identity cascade",
  );
});

/** Seed an open node citing a one-span evidence row. */
async function seed(core: Marrow, kind: "decision" | "entity", text: string): Promise<string> {
  const evidenceId = await core.ingest({ text, source: "room" });
  const span = { evidenceId, start: 0, end: text.length };
  if (kind === "decision") {
    const node = await core.proposeNode({ kind: "decision", title: text, provenance: [span] });
    return node.id;
  }
  const node = await core.proposeNode({ kind: "entity", name: text, provenance: [span] });
  return node.id;
}

describe("search is semantic, not substring", () => {
  it("finds a paraphrased decision that shares no words with the query", async () => {
    const core = new Marrow(store, undefined, createConceptEmbedding());
    const authId = await seed(core, "decision", "magic links, no shared passwords");
    await seed(core, "entity", "billing webhooks retry with backoff");

    // the query shares NO substring with the auth decision: a grep finds nothing.
    expect(await store.searchNodes("passwordless")).toHaveLength(0);

    // semantic search still returns the auth decision, and only it, at k=1.
    const top = await core.search("passwordless authentication", 1);
    expect(top).toHaveLength(1);
    expect(top[0]?.id).toBe(authId);
  });

  it("ranks the on-topic node above an off-topic one", async () => {
    const core = new Marrow(store, undefined, createConceptEmbedding());
    const sessionId = await seed(core, "decision", "sessions expire after 8 hours, lock when idle");
    await seed(core, "decision", "billing webhooks retry with backoff");

    // a session paraphrase (idle / timeout / logout) that shares no concept word
    // with billing: the session node must rank first on meaning, not tie-break.
    const results = await core.search("idle timeout and logout policy", 8);
    expect(results[0]?.id).toBe(sessionId); // session topic ranks first
  });

  it("falls back to substring search when no embedding provider is configured", async () => {
    const core = new Marrow(store); // no embedder
    const id = await seed(core, "decision", "magic links, no shared passwords");
    // without embeddings, retrieval is keyword-only: an exact term still matches.
    const hits = await core.search("magic links", 5);
    expect(hits.map((n) => n.id)).toContain(id);
  });

  it("records keyword mode when a configured embedder returns no query vector", async () => {
    const core = new Marrow(store, undefined, new EmptyEmbedding());
    await seed(core, "decision", "magic links, no shared passwords");

    const hits = await core.search("magic links", 5);
    expect(hits.length).toBeGreaterThan(0);

    const runs = await store.listRuns({ kind: "search", limit: 1 });
    expect(runs[0]?.metadata).toMatchObject({ mode: "keyword" });
  });
});

describe("entity lookup", () => {
  it("gets an entity by id or name and returns undefined for an unknown lookup", async () => {
    const core = new Marrow(store, undefined, createConceptEmbedding());
    const evidenceId = await core.ingest({
      text: "Billing webhooks retry with backoff",
      source: "room",
    });
    const entity = await core.proposeNode({
      kind: "entity",
      name: "Billing webhooks",
      provenance: [{ evidenceId, start: 0, end: "Billing webhooks".length }],
    });
    if (entity.kind !== "entity") throw new Error("expected an entity");

    expect((await core.getEntity(entity.id))?.id).toBe(entity.id);
    expect((await core.getEntity("Billing webhooks"))?.id).toBe(entity.id);
    expect((await core.findEntities("webhooks")).map((e) => e.id)).toContain(entity.id);
    expect((await core.listEntities()).map((e) => e.id)).toContain(entity.id);
    expect(await core.getEntity("missing concept")).toBeUndefined();
  });
});

describe("raw evidence search", () => {
  it("returns only matching append-only evidence rows through the core facade", async () => {
    const core = new Marrow(store);
    const marker = `core-evidence-search-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const matchingId = await core.ingest({
      text: `The room decided ${marker} belongs in raw evidence search.`,
      source: "interviews/match.md",
    });
    await core.ingest({
      text: "A different raw evidence row about billing webhooks.",
      source: "interviews/miss.md",
    });

    const hits = await core.searchEvidence(marker);
    expect(hits.map((ev) => ev.id)).toEqual([matchingId]);
    expect(hits[0]).toMatchObject({
      kind: "evidence",
      source: "interviews/match.md",
    });
  });
});
