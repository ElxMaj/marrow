import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { type DiffHunk } from "./drift.js";
import {
  runEval,
  assertNoSyntheticFalsePositives,
  type EvalCase,
  loadSyntheticGolden,
} from "./eval.js";
import { Marrow } from "./marrow.js";
import { Store } from "./store.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";
const here = dirname(fileURLToPath(import.meta.url));

let store: Store;
let core: Marrow;
let admin: pg.Pool;

function hunk(path: string, newLines: string, lineStart = 1): DiffHunk {
  return {
    path,
    lineStart,
    lineEnd: lineStart + newLines.split("\n").length - 1,
    oldLines: "",
    newLines,
    hunkHeader: "@@ -0,0 +1,1 @@",
  };
}

beforeAll(() => {
  execFileSync("node", [join(here, "..", "scripts", "migrate.mjs")], {
    env: { ...process.env, DATABASE_URL },
    stdio: "ignore",
  });
  store = new Store(DATABASE_URL);
  core = new Marrow(store);
  admin = new pg.Pool({ connectionString: DATABASE_URL });
});

afterAll(async () => {
  await store.close();
  await admin.end();
});

beforeEach(async () => {
  await admin.query(
    "truncate catch_events, provenance, embedding, entity, decision, question, goal restart identity cascade",
  );
});

describe("golden-set eval", () => {
  it("scores a true-positive catch", async () => {
    const report = await runEval(core, [
      {
        name: "password-drift",
        decisions: [{ title: "no passwords, magic links only" }],
        hunks: [hunk("src/auth.ts", "const passwordHash = hash(password);")],
        expected: [{ hunkIndex: 0, decisionIndex: 0 }],
        synthetic: true,
      },
    ]);
    expect(report.cases[0]?.truePositives).toBe(1);
    expect(report.cases[0]?.falsePositives).toBe(0);
    expect(report.precision).toBe(1);
    expect(report.recall).toBe(1);
    assertNoSyntheticFalsePositives(report);
  });

  it("scores a false-negative when the catch misses", async () => {
    const report = await runEval(core, [
      {
        name: "missed-drift",
        decisions: [{ title: "use soft deletes" }],
        hunks: [hunk("src/db.ts", "const x = 1;")],
        expected: [{ hunkIndex: 0, decisionIndex: 0 }],
        synthetic: true,
      },
    ]);
    expect(report.cases[0]?.truePositives).toBe(0);
    expect(report.cases[0]?.falseNegatives).toBe(1);
    expect(report.recall).toBe(0);
  });

  it("scores a false-positive on a non-contradiction", async () => {
    const report = await runEval(core, [
      {
        name: "password-comment-false-positive",
        decisions: [{ title: "no passwords, magic links only" }],
        hunks: [hunk("src/auth.ts", "// TODO: document why we avoid passwords")],
        expected: [],
        synthetic: false,
      },
    ]);
    expect(report.cases[0]?.falsePositives).toBeGreaterThan(0);
  });

  it("refuses to score zero cases: an empty run is not a perfect run", async () => {
    await expect(runEval(core, [])).rejects.toThrow(/zero cases/);
  });

  it("ships a loadable bundled golden set", () => {
    const cases = loadSyntheticGolden();
    expect(cases.length).toBeGreaterThanOrEqual(3);
    expect(cases.every((c) => c.synthetic)).toBe(true);
  });

  it("meets the synthetic golden-set precision and recall gate", async () => {
    const fixture = join(here, "..", "fixtures", "synthetic-golden.json");
    const cases = JSON.parse(readFileSync(fixture, "utf8")) as EvalCase[];
    expect(cases.every((c) => c.synthetic)).toBe(true);
    const report = await runEval(core, cases);
    expect(report.precision).toBeGreaterThanOrEqual(0.75);
    expect(report.recall).toBeGreaterThanOrEqual(0.5);
    assertNoSyntheticFalsePositives(report);
  });
});
