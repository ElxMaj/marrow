import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { doctor } from "./doctor.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";
const here = dirname(fileURLToPath(import.meta.url));

const byName = (checks: { name: string; status: string }[], name: string): { status: string } =>
  checks.find((c) => c.name === name) ?? { status: "missing" };

describe("doctor", () => {
  beforeAll(() => {
    // make sure the shared db is migrated so the healthy path is deterministic.
    execFileSync("node", [join(here, "..", "scripts", "migrate.mjs")], {
      env: { ...process.env, DATABASE_URL },
      stdio: "ignore",
    });
  });

  afterAll(() => undefined);

  it("greenlights a migrated database and never throws", async () => {
    const checks = await doctor(DATABASE_URL);
    expect(byName(checks, "DATABASE_URL").status).toBe("ok");
    expect(byName(checks, "Postgres").status).toBe("ok");
    expect(byName(checks, "Schema").status).toBe("ok");
    // Distillation depends on whether a model key is in the env; either way it is
    // never an error (reads and ingestion work without a model).
    expect(["ok", "warn"]).toContain(byName(checks, "Distillation").status);
  });

  it("surfaces the undistilled backlog: ingested evidence that never became facts", async () => {
    // The most likely first-run confusion: ingest worked, nothing appeared.
    // Doctor must name it with a remedy instead of leaving the loop to look empty.
    const { Store } = await import("./store.js");
    const store = new Store(DATABASE_URL);
    try {
      await store.insertEvidence({
        text: `doctor backlog probe ${Date.now()}`,
        source: "doctor-test/backlog.md",
      });
      const checks = await doctor(DATABASE_URL);
      const backlog = checks.find((c) => c.name === "Backlog");
      expect(backlog?.status).toBe("warn");
      expect(backlog?.detail).toMatch(/never distilled/);
      expect(backlog?.remedy).toMatch(/distill/);
    } finally {
      await store.close();
    }
  });

  it("reports a missing DATABASE_URL as an error, without throwing", async () => {
    const checks = await doctor("");
    expect(byName(checks, "DATABASE_URL").status).toBe("error");
    expect(byName(checks, "Postgres").status).toBe("warn"); // skipped, not crashed
    expect(byName(checks, "Schema").status).toBe("warn");
  });

  it("reports an unreachable Postgres as an error, without throwing", async () => {
    const checks = await doctor("postgres://marrow:marrow@127.0.0.1:1/marrow");
    expect(byName(checks, "DATABASE_URL").status).toBe("ok");
    expect(byName(checks, "Postgres").status).toBe("error");
    expect(byName(checks, "Schema").status).toBe("warn"); // skipped when unreachable
  });

  it("reports an unmigrated database as a schema error", async () => {
    // point at a real, reachable server but a database with no _migrations table.
    const admin = new (await import("pg")).default.Pool({ connectionString: DATABASE_URL });
    const TEST_DB = "marrow_doctor_test";
    try {
      await admin.query(`drop database if exists ${TEST_DB}`);
      await admin.query(`create database ${TEST_DB}`);
      const url = (() => {
        const u = new URL(DATABASE_URL);
        u.pathname = `/${TEST_DB}`;
        return u.toString();
      })();
      const checks = await doctor(url);
      expect(byName(checks, "Postgres").status).toBe("ok");
      expect(byName(checks, "Schema").status).toBe("error");
    } finally {
      await admin.query(`drop database if exists ${TEST_DB}`);
      await admin.end();
    }
  });
});
