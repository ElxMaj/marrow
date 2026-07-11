import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createReplayModel, loadWriteGolden, runWriteEval } from "./eval-write.js";
import { Marrow } from "./marrow.js";
import { type EmbeddingProvider, type EmbeddingResult } from "./providers/types.js";
import { Store } from "./store.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";
const here = dirname(fileURLToPath(import.meta.url));

class FakeEmbedding implements EmbeddingProvider {
  readonly model = "fake-emb";
  embed(texts: string[]): Promise<EmbeddingResult> {
    return Promise.resolve({ vectors: texts.map(() => [0, 0, 0, 0]), model: this.model, dim: 4 });
  }
}

let store: Store;
let admin: pg.Pool;

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

const resetDistilled = async () => {
  // evidence stays append only, even here: only the distilled layer resets.
  await admin.query(
    "truncate catch_events, verification, provenance, embedding, edge, entity, decision, question, goal restart identity cascade",
  );
};

describe("write-quality eval (the Mem0 lesson, gated)", () => {
  it("refuses to score zero cases", async () => {
    const replay = createReplayModel();
    const core = new Marrow(store, replay.provider, new FakeEmbedding());
    await expect(runWriteEval(core, replay, [], resetDistilled)).rejects.toThrow(/zero cases/);
  });

  it("ships a loadable bundled golden set covering the junk classes", () => {
    const cases = loadWriteGolden();
    expect(cases.length).toBeGreaterThanOrEqual(5);
    expect(cases.every((c) => c.trap.length > 0)).toBe(true);
    const traps = cases.map((c) => c.trap).join(" ");
    expect(traps).toMatch(/hallucinated/i);
    expect(traps).toMatch(/near-duplicates/i);
    expect(traps).toMatch(/transient/i);
  });

  it("meets the write-quality gates on the golden set", async () => {
    const replay = createReplayModel();
    const core = new Marrow(store, replay.provider, new FakeEmbedding());
    const report = await runWriteEval(core, replay, loadWriteGolden(), resetDistilled);

    // the drop-guard's proof: a stored span is ALWAYS a verbatim substring.
    expect(report.falseMemoryRate).toBe(0);
    // labeled expectations are met.
    expect(report.writePrecision).toBeGreaterThanOrEqual(0.8);
    expect(report.writePrecision).toBeLessThanOrEqual(1);
    expect(report.writeRecall).toBeGreaterThanOrEqual(0.8);
    // a rate above 1 means the accounting is broken, not that we are great.
    expect(report.writeRecall).toBeLessThanOrEqual(1);
    // entities merge at write time; their restatement never duplicates.
    expect(report.entityDuplicateRate).toBe(0);
    // decisions and goals have no write-time near-duplicate guard until R17:
    // the rate is reported honestly, and this pin flips when R17 lands.
    expect(report.duplicateRate).toBeGreaterThan(0);
    // synchronous distillation: written facts are retrievable when the call
    // returns, and the measured window stays sane.
    expect(report.ingestionReadyP95Ms).toBeGreaterThan(0);
    expect(report.cases).toHaveLength(loadWriteGolden().length);
  });

  it("drops the hallucinated-quote decision instead of storing plausible junk", async () => {
    const replay = createReplayModel();
    const core = new Marrow(store, replay.provider, new FakeEmbedding());
    const hallucination = loadWriteGolden().find((c) => /hallucinated/i.test(c.trap));
    if (!hallucination) throw new Error("expected the hallucination case");
    const report = await runWriteEval(core, replay, [hallucination], resetDistilled);
    const created = report.cases[0]?.created ?? [];
    expect(created.some((n) => /kafka/i.test(n.title))).toBe(false);
    expect(created.some((n) => n.title === "export job")).toBe(true);
    expect(report.falseMemoryRate).toBe(0);
  });

  it("records the tentative leaning as a question, never a decision", async () => {
    const replay = createReplayModel();
    const core = new Marrow(store, replay.provider, new FakeEmbedding());
    const tentative = loadWriteGolden().find((c) => /transient/i.test(c.trap));
    if (!tentative) throw new Error("expected the tentative case");
    const report = await runWriteEval(core, replay, [tentative], resetDistilled);
    const created = report.cases[0]?.created ?? [];
    expect(created.some((n) => n.kind === "decision")).toBe(false);
    expect(created.some((n) => n.kind === "question")).toBe(true);
  });
});
