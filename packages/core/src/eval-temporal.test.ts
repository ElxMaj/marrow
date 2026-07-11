import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createConceptEmbedding } from "./demo.js";
import { loadTemporalGolden, runTemporalEval } from "./eval-temporal.js";
import { Marrow } from "./marrow.js";
import { Store } from "./store.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";
const here = dirname(fileURLToPath(import.meta.url));

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
  await admin.query(
    "truncate catch_events, verification, provenance, embedding, edge, entity, decision, question, goal restart identity cascade",
  );
};

describe("temporal accuracy eval (invalidation, not erasure)", () => {
  it("refuses to score zero cases", async () => {
    const core = new Marrow(store, undefined, createConceptEmbedding());
    await expect(runTemporalEval(core, [], resetDistilled)).rejects.toThrow(/zero cases/);
  });

  it("current state wins everywhere and history stays reachable, at 1.0", async () => {
    const core = new Marrow(store, undefined, createConceptEmbedding());
    const report = await runTemporalEval(core, loadTemporalGolden(), resetDistilled);
    // after a human resolves a conflict, every surface serves the winner...
    expect(report.currentStateAccuracy).toBe(1);
    // ...and the loser is still fully reachable with its content intact.
    expect(report.historicalAccuracy).toBe(1);
    expect(report.cases.length).toBeGreaterThanOrEqual(4);
  });

  it("runs keyless too: keyword mode gives the same guarantees on keyword topics", async () => {
    const core = new Marrow(store); // no embedding: keyword search path
    // keyword search matches substrings, not paraphrases (a known, documented
    // limit of keyless mode), so this arm asks with the shared-word topic.
    const cases = loadTemporalGolden().map((c) => ({ ...c, topic: c.keywordTopic }));
    const report = await runTemporalEval(core, cases, resetDistilled);
    expect(report.currentStateAccuracy).toBe(1);
    expect(report.historicalAccuracy).toBe(1);
  });
});
