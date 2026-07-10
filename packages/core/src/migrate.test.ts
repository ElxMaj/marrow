import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrate } from "./migrate.js";

// migrate() must set up a fresh Postgres end to end, so the test runs it against
// a throwaway database (not the shared brain), then proves idempotence. The role
// is a superuser in CI (the pgvector image) and locally, so create/drop database
// works; 0001 creates the vector extension itself, so the fresh db needs no prep.
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";
const TEST_DB = "marrow_migrate_test";
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");

const testUrl = (): string => {
  const u = new URL(DATABASE_URL);
  u.pathname = `/${TEST_DB}`;
  return u.toString();
};

let admin: pg.Pool;

const dropTestDb = async (): Promise<void> => {
  // terminate any leftover connections before dropping, so the drop never blocks.
  await admin.query(
    `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
    [TEST_DB],
  );
  await admin.query(`drop database if exists ${TEST_DB}`);
};

beforeAll(async () => {
  admin = new pg.Pool({ connectionString: DATABASE_URL });
  await dropTestDb();
  await admin.query(`create database ${TEST_DB}`);
});

afterAll(async () => {
  await dropTestDb();
  await admin.end();
});

describe("migrate", () => {
  it("throws the shared first-run error when no database url is set", async () => {
    await expect(migrate("")).rejects.toThrow(/DATABASE_URL is not set/);
  });

  it("applies every migration to a fresh database in filename order", async () => {
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    const result = await migrate(testUrl());
    expect(result.applied).toEqual(files);
    expect(result.alreadyApplied).toBe(0);
  });

  it("is idempotent: a second run applies nothing", async () => {
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql"));
    const result = await migrate(testUrl());
    expect(result.applied).toEqual([]);
    expect(result.alreadyApplied).toBe(files.length);
  });
});
