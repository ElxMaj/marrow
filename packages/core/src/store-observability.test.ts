import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
  // a full harness reset so the dedup check starts from a clean evidence table.
  // the local Postgres persists between runs, so a source inserted by a prior
  // run would otherwise leak into hasEvidenceSource.
  await admin.query(
    "truncate run, connector_state, connector_config, evidence, provenance, embedding, entity, decision, question, goal, catch_events restart identity cascade",
  );
});

describe("observability runs", () => {
  it("records a run and reads it back with all fields", async () => {
    const run = await store.recordRun({
      kind: "distill",
      status: "ok",
      label: "standup.md",
      model: "claude-x",
      tokensIn: 1200,
      tokensOut: 340,
      costUsd: 0.0051,
      latencyMs: 812.6,
      inputSummary: "a standup transcript",
      outputSummary: "3 decisions, 2 questions",
      metadata: { chunks: 2 },
    });
    expect(run.id).toMatch(/^run_/);
    expect(run.kind).toBe("distill");
    expect(run.latencyMs).toBe(813); // rounded
    const read = await store.getRun(run.id);
    expect(read?.tokensIn).toBe(1200);
    expect(read?.costUsd).toBeCloseTo(0.0051, 6);
    expect(read?.metadata).toEqual({ chunks: 2 });
    expect(read?.label).toBe("standup.md");
  });

  it("omits optional fields that were not provided (exactOptional)", async () => {
    const run = await store.recordRun({ kind: "search", status: "ok", latencyMs: 12 });
    const read = await store.getRun(run.id);
    expect(read).toBeDefined();
    expect("tokensIn" in (read as object)).toBe(false);
    expect("model" in (read as object)).toBe(false);
    expect(read?.latencyMs).toBe(12);
  });

  it("rejects invalid run drafts before inserting", async () => {
    await expect(store.recordRun({ kind: "search", status: "ok", latencyMs: -1 })).rejects.toThrow(
      /latencyMs/,
    );
    const res = await admin.query("select count(*)::int as count from run");
    expect(res.rows[0]?.count).toBe(0);
  });

  it("lists runs newest first, filterable by kind and status, bounded", async () => {
    await store.recordRun({ kind: "search", status: "ok", latencyMs: 5 });
    await store.recordRun({ kind: "distill", status: "ok", latencyMs: 5 });
    await store.recordRun({ kind: "distill", status: "error", error: "boom", latencyMs: 5 });

    const all = await store.listRuns();
    expect(all.length).toBe(3);

    const distills = await store.listRuns({ kind: "distill" });
    expect(distills.length).toBe(2);
    expect(distills.every((r) => r.kind === "distill")).toBe(true);

    const errors = await store.listRuns({ status: "error" });
    expect(errors.length).toBe(1);
    expect(errors[0]?.error).toBe("boom");

    const one = await store.listRuns({ limit: 1 });
    expect(one.length).toBe(1);
  });

  it("pages runs with a before cursor and caps the limit at 1000", async () => {
    const first = await store.recordRun({ kind: "search", status: "ok", latencyMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await store.recordRun({ kind: "search", status: "ok", latencyMs: 2 });

    const beforeSecond = await store.listRuns({ before: second.createdAt });
    expect(beforeSecond.map((r) => r.id)).toContain(first.id);
    expect(beforeSecond.map((r) => r.id)).not.toContain(second.id);

    for (let i = 0; i < 1005; i += 1) {
      await store.recordRun({ kind: "search", status: "ok", latencyMs: i });
    }
    expect((await store.listRuns({ limit: 5000 })).length).toBe(1000);
  });

  it("aggregates metrics: counts, errors, tokens, cost, latency, by kind", async () => {
    await store.recordRun({
      kind: "distill",
      status: "ok",
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.01,
      latencyMs: 100,
    });
    await store.recordRun({
      kind: "distill",
      status: "ok",
      tokensIn: 300,
      tokensOut: 70,
      costUsd: 0.03,
      latencyMs: 300,
    });
    await store.recordRun({ kind: "search", status: "error", error: "x", latencyMs: 1000 });

    const m = await store.runMetrics();
    expect(m.count).toBe(3);
    expect(m.errorCount).toBe(1);
    expect(m.totalTokensIn).toBe(400);
    expect(m.totalTokensOut).toBe(120);
    expect(m.totalCostUsd).toBeCloseTo(0.04, 6);
    expect(m.p50LatencyMs).toBeGreaterThan(0);
    expect(m.p95LatencyMs).toBeGreaterThanOrEqual(m.p50LatencyMs);
    expect(m.byKind.distill?.count).toBe(2);
    expect(m.byKind.distill?.costUsd).toBeCloseTo(0.04, 6);
    expect(m.byKind.search?.errorCount).toBe(1);
  });
});

describe("hasEvidenceSource (connector dedup)", () => {
  it("is true only after the exact source is ingested", async () => {
    expect(await store.hasEvidenceSource("slack:C1:1.0")).toBe(false);
    await store.insertEvidence({ text: "hello", source: "slack:C1:1.0" });
    expect(await store.hasEvidenceSource("slack:C1:1.0")).toBe(true);
    expect(await store.hasEvidenceSource("slack:C1:2.0")).toBe(false);
  });
});

describe("connector sync state", () => {
  it("advances the cursor and accumulates items on success", async () => {
    const t1 = "2026-06-01T00:00:00.000Z";
    const s1 = await store.recordSyncOutcome("slack", {
      ok: true,
      cursor: t1,
      itemsIngested: 4,
      ranAt: t1,
    });
    expect(s1.lastStatus).toBe("ok");
    expect(s1.cursor).toBe(t1);
    expect(s1.totalItems).toBe(4);
    expect(s1.itemsLastRun).toBe(4);

    const t2 = "2026-06-02T00:00:00.000Z";
    const s2 = await store.recordSyncOutcome("slack", {
      ok: true,
      cursor: t2,
      itemsIngested: 3,
      ranAt: t2,
    });
    expect(s2.cursor).toBe(t2);
    expect(s2.totalItems).toBe(7);
    expect(s2.itemsLastRun).toBe(3);
  });

  it("keeps the cursor and records the error on failure", async () => {
    const t1 = "2026-06-01T00:00:00.000Z";
    await store.recordSyncOutcome("jira", { ok: true, cursor: t1, itemsIngested: 2, ranAt: t1 });
    const t2 = "2026-06-02T00:00:00.000Z";
    const failed = await store.recordSyncOutcome("jira", {
      ok: false,
      itemsIngested: 0,
      error: "401 unauthorized",
      ranAt: t2,
    });
    expect(failed.lastStatus).toBe("error");
    expect(failed.lastError).toBe("401 unauthorized");
    expect(failed.cursor).toBe(t1); // unchanged
    expect(failed.totalItems).toBe(2);
  });

  it("lists all connector state", async () => {
    const t = "2026-06-01T00:00:00.000Z";
    await store.recordSyncOutcome("slack", { ok: true, cursor: t, itemsIngested: 1, ranAt: t });
    await store.recordSyncOutcome("email", { ok: true, cursor: t, itemsIngested: 1, ranAt: t });
    const all = await store.listConnectorState();
    expect(all.map((s) => s.name).sort()).toEqual(["email", "slack"]);
  });
});

describe("connector config", () => {
  it("stores config, never exposes the secret, reports hasSecret", async () => {
    const cfg = await store.upsertConnectorConfig({
      name: "slack",
      kind: "slack",
      enabled: true,
      settings: { channelIds: ["C1"] },
      secretCipher: "cipher-abc",
    });
    expect(cfg.hasSecret).toBe(true);
    expect((cfg as Record<string, unknown>).secretCipher).toBeUndefined();
    expect(cfg.settings).toEqual({ channelIds: ["C1"] });

    const cipher = await store.getConnectorSecretCipher("slack");
    expect(cipher).toBe("cipher-abc");
  });

  it("a settings-only update preserves the existing secret", async () => {
    await store.upsertConnectorConfig({
      name: "jira",
      kind: "jira",
      enabled: true,
      settings: { baseUrl: "x.atlassian.net" },
      secretCipher: "secret-1",
    });
    await store.upsertConnectorConfig({
      name: "jira",
      kind: "jira",
      enabled: true,
      settings: { baseUrl: "y.atlassian.net" },
      // no secretCipher -> keep existing
    });
    expect(await store.getConnectorSecretCipher("jira")).toBe("secret-1");
    const cfg = await store.getConnectorConfig("jira");
    expect(cfg?.settings).toEqual({ baseUrl: "y.atlassian.net" });
    expect(cfg?.hasSecret).toBe(true);
  });

  it("toggles enabled, lists, and deletes", async () => {
    await store.upsertConnectorConfig({
      name: "email",
      kind: "email",
      enabled: true,
      settings: {},
    });
    await store.setConnectorEnabled("email", false);
    expect((await store.getConnectorConfig("email"))?.enabled).toBe(false);
    expect((await store.listConnectorConfigs()).length).toBe(1);
    await store.deleteConnectorConfig("email");
    expect(await store.getConnectorConfig("email")).toBeUndefined();
  });
});
