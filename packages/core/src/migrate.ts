// Programmatic schema migration, so the published `marrow` bin can set up a
// fresh Postgres itself (`marrow migrate`) without the pnpm workspace. Same
// contract as scripts/migrate.mjs (which `pnpm db:migrate` still uses): apply
// every unapplied migrations/*.sql in filename order, each in its own
// transaction, recorded in _migrations. Idempotent and re-runnable, because the
// raw layer never moves under it.
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
// migrations/ sits one level above both src (tests) and dist (published), so
// ".." resolves in both, the same way scripts/migrate.mjs resolves it.
const migrationsDir = join(here, "..", "migrations");

export interface MigrateResult {
  /** Migration filenames applied on this run, in filename order. */
  applied: string[];
  /** How many migrations were already applied before this run. */
  alreadyApplied: number;
}

/**
 * Bring the schema at `databaseUrl` up to date. Returns what it applied so a CLI
 * or agent can report progress. Throws with the same message as createStore when
 * no url is set, so the one first-run error reads consistently everywhere.
 */
export async function migrate(
  databaseUrl: string | undefined = process.env.DATABASE_URL,
): Promise<MigrateResult> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set. Point it at your Postgres and retry.");
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query(
      `create table if not exists _migrations (
         name text primary key,
         applied_at timestamptz not null default now()
       )`,
    );
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    const already = new Set(
      (await client.query<{ name: string }>("select name from _migrations")).rows.map(
        (r) => r.name,
      ),
    );

    const applied: string[] = [];
    for (const file of files) {
      if (already.has(file)) continue;
      const sql = await readFile(join(migrationsDir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into _migrations (name) values ($1)", [file]);
        await client.query("commit");
        applied.push(file);
      } catch (err) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    return { applied, alreadyApplied: already.size };
  } finally {
    client.release();
    await pool.end();
  }
}
