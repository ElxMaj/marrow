// db:migrate runner. plain JS so `pnpm db:migrate` runs with no build step,
// the same in CI and locally. applies every unapplied migrations/*.sql in
// filename order inside a transaction and records it in _migrations. Reads
// DATABASE_URL from the environment, never a hardcoded connection string.
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("db:migrate: DATABASE_URL is not set. Point it at your Postgres and retry.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url });

async function main() {
  const client = await pool.connect();
  try {
    await client.query(
      `create table if not exists _migrations (
         name text primary key,
         applied_at timestamptz not null default now()
       )`,
    );
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    const applied = new Set(
      (await client.query("select name from _migrations")).rows.map((r) => r.name),
    );

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(migrationsDir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into _migrations (name) values ($1)", [file]);
        await client.query("commit");
        count += 1;
        console.log(`db:migrate: applied ${file}`);
      } catch (err) {
        await client.query("rollback");
        throw new Error(`db:migrate: ${file} failed: ${err.message}`);
      }
    }
    console.log(
      count === 0 ? "db:migrate: already up to date" : `db:migrate: applied ${count} migration(s)`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
