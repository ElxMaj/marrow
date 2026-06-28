import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { estimateCostUsd, traced } from "./observability.js";
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

beforeEach(async () => {
  await admin.query("truncate run restart identity cascade");
});

describe("estimateCostUsd", () => {
  it("prices known models per million tokens", () => {
    // opus: $15/M in, $75/M out
    expect(estimateCostUsd("claude-opus-4-8", 1_000_000, 1_000_000)).toBeCloseTo(90, 6);
    expect(estimateCostUsd("claude-3-5-sonnet", 1_000_000, 0)).toBeCloseTo(3, 6);
  });

  it("returns undefined for an unknown model rather than a fake zero", () => {
    expect(estimateCostUsd("some-local-llm", 1000, 1000)).toBeUndefined();
    expect(estimateCostUsd(undefined, 1000, 1000)).toBeUndefined();
  });
});

describe("traced", () => {
  it("records one ok run with reported tokens and an estimated cost", async () => {
    const result = await traced(store, { kind: "distill", label: "x.md" }, async (report) => {
      report({
        model: "claude-3-5-sonnet",
        tokensIn: 1000,
        tokensOut: 200,
        outputSummary: "3 nodes",
      });
      return "done";
    });
    expect(result).toBe("done");
    const runs = await store.listRuns({ kind: "distill" });
    expect(runs.length).toBe(1);
    const run = runs[0];
    expect(run?.status).toBe("ok");
    expect(run?.tokensIn).toBe(1000);
    expect(run?.tokensOut).toBe(200);
    // sonnet: (1000*3 + 200*15)/1e6 = 0.006
    expect(run?.costUsd).toBeCloseTo(0.006, 6);
    expect(run?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(run?.outputSummary).toBe("3 nodes");
  });

  it("records an error run and rethrows the original error", async () => {
    await expect(
      traced(store, { kind: "search" }, async () => {
        throw new Error("kaboom");
      }),
    ).rejects.toThrow("kaboom");
    const runs = await store.listRuns({ status: "error" });
    expect(runs.length).toBe(1);
    expect(runs[0]?.kind).toBe("search");
    expect(runs[0]?.error).toBe("kaboom");
  });

  it("never lets a telemetry failure mask the real result", async () => {
    const brokenStore = {
      recordRun: async (): Promise<never> => {
        throw new Error("db down");
      },
    };
    // even though recording throws, the wrapped operation's result passes through.
    const out = await traced(brokenStore, { kind: "ingest" }, async () => 42);
    expect(out).toBe(42);
  });
});
