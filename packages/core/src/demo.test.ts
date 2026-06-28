import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDemoEmbedding, createDemoModel, runDemo } from "./demo.js";
import { Marrow } from "./marrow.js";
import { Store } from "./store.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";
const here = dirname(fileURLToPath(import.meta.url));
const interviewPath = join(here, "..", "fixtures", "demo", "design-partner.md");

let store: Store;
let admin: pg.Pool;
let interview: string;

const freshCore = (): Marrow => new Marrow(store, createDemoModel(), createDemoEmbedding());

beforeAll(async () => {
  execFileSync("node", [join(here, "..", "scripts", "migrate.mjs")], {
    env: { ...process.env, DATABASE_URL },
    stdio: "ignore",
  });
  store = new Store(DATABASE_URL);
  admin = new pg.Pool({ connectionString: DATABASE_URL });
  interview = await readFile(interviewPath, "utf8");
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

describe("hero demo", () => {
  it("ends with the soft-delete decision decided, provenance to the interview", async () => {
    const result = await runDemo(freshCore(), interview);
    expect(result.decision.status).toBe("decided");
    expect(result.decision.confidence.source).toBe("human");
    const span = result.trace.spans.find((s) => s.source.includes("design-partner"));
    if (!span) throw new Error("expected provenance back to the interview");
    expect(span.spanText.length).toBeGreaterThan(0);
  });

  it("trace_to_source returns the exact interview line", async () => {
    const result = await runDemo(freshCore(), interview);
    const span = result.trace.spans.find((s) => s.source.includes("design-partner"));
    expect(span?.spanText).toContain("Soft delete");
  });

  it("the agent's question gets a decided, sourced answer; backup retention stays open", async () => {
    const result = await runDemo(freshCore(), interview);
    expect(result.answer.length).toBeGreaterThan(0);
    expect(
      result.answer.some(
        (n) => n.kind === "decision" && n.status === "decided" && /soft delete/i.test(n.title),
      ),
    ).toBe(true);
    expect(result.openQuestions.some((q) => /backup retention/i.test(q.prompt))).toBe(true);
  });
});
