import { randomBytes } from "node:crypto";

import pg from "pg";

import { migrate } from "./migrate.js";

// A disposable schema on the SAME Postgres, so evals and benchmarks can seed
// and score a brain without ever touching the user's real one. One datastore
// stays the rule: this is a schema inside it, created for the run and dropped
// after, never a second database or service.

/** Derive a connection URL whose search_path points at the scratch schema
 *  (public stays second so the pgvector type keeps resolving). */
export function scratchSchemaUrl(databaseUrl: string, schema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("options", `-csearch_path=${schema},public`);
  return url.toString();
}

/** Create a scratch schema, migrate it, run fn against it, and drop it no
 *  matter what. The name carries a random suffix so concurrent runs never
 *  collide. */
export async function withScratchSchema<T>(
  databaseUrl: string,
  fn: (scratchUrl: string) => Promise<T>,
): Promise<T> {
  const schema = `marrow_scratch_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  try {
    await admin.query(`create schema "${schema}"`);
    try {
      const scratchUrl = scratchSchemaUrl(databaseUrl, schema);
      await migrate(scratchUrl);
      return await fn(scratchUrl);
    } finally {
      await admin.query(`drop schema "${schema}" cascade`);
    }
  } finally {
    await admin.end();
  }
}
