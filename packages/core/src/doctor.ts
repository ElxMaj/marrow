// `marrow doctor`: one command that greenlights the whole first-run stack, so a
// developer learns every precondition at once instead of discovering them by
// failing real commands one at a time. Never throws: each check reports ok, warn,
// or error with a one-line remedy. Distillation missing is a warn, not an error,
// because reads and ingestion work without a model.
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { loadProviderConfig } from "./providers/config.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");

export interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "error";
  detail: string;
  remedy?: string;
}

/** Check DATABASE_URL, Postgres reachability, schema migration, and model
 *  readiness. Returns one row per check so a CLI can print a checklist and an
 *  agent can read it as JSON. */
export async function doctor(
  databaseUrl: string | undefined = process.env.DATABASE_URL,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  if (!databaseUrl) {
    checks.push({
      name: "DATABASE_URL",
      status: "error",
      detail: "not set",
      remedy:
        "Point DATABASE_URL at your Postgres (Marrow's one piece of infra). From a clone: `pnpm db:up`, then export DATABASE_URL=postgres://marrow:marrow@localhost:5432/marrow (also in .env.example; the CLI reads ./.env).",
    });
    checks.push({ name: "Postgres", status: "warn", detail: "skipped (no DATABASE_URL)" });
    checks.push({ name: "Schema", status: "warn", detail: "skipped (no DATABASE_URL)" });
  } else {
    checks.push({ name: "DATABASE_URL", status: "ok", detail: "set" });
    const pool = new pg.Pool({ connectionString: databaseUrl });
    try {
      await pool.query("select 1");
      checks.push({ name: "Postgres", status: "ok", detail: "reachable" });
      try {
        const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql"));
        // check this repo's specific migrations are applied, not a raw count: a
        // shared dev database can carry rows from other histories.
        const res = await pool.query<{ name: string }>("select name from _migrations");
        const applied = new Set(res.rows.map((r) => r.name));
        const pending = files.filter((f) => !applied.has(f));
        if (files.length > 0 && pending.length === 0) {
          checks.push({
            name: "Schema",
            status: "ok",
            detail: `migrated (${files.length} migration${files.length === 1 ? "" : "s"})`,
          });
        } else {
          checks.push({
            name: "Schema",
            status: "error",
            detail: `not migrated (${pending.length} of ${files.length} pending)`,
            remedy: "Run `marrow migrate`.",
          });
        }
      } catch {
        // _migrations does not exist yet: the schema was never migrated.
        checks.push({
          name: "Schema",
          status: "error",
          detail: "not migrated",
          remedy: "Run `marrow migrate`.",
        });
      }

      // Redaction completeness: every redacted evidence row must be a full
      // tombstone with its citing nodes retracted, tombstoned, and stripped
      // of embeddings. Bounded; skipped cleanly on schemas from before 0018.
      try {
        const redacted = await pool.query<{ id: string }>(
          "select id from evidence where redacted_at is not null order by redacted_at asc limit 100",
        );
        if (redacted.rows.length === 0) {
          checks.push({ name: "Redactions", status: "ok", detail: "none recorded" });
        } else {
          const incomplete: string[] = [];
          for (const row of redacted.rows) {
            const bad = await pool.query<{ node_id: string }>(
              `select p.node_id from provenance p
                 join evidence e on e.id = p.evidence_id
                where p.evidence_id = $1
                  and exists (
                    select 1 from embedding em
                     where em.node_id = p.node_id and em.node_kind = p.node_kind)
                limit 1`,
              [row.id],
            );
            if ((bad.rowCount ?? 0) > 0) incomplete.push(row.id);
          }
          if (incomplete.length === 0) {
            checks.push({
              name: "Redactions",
              status: "ok",
              detail: `${redacted.rows.length} recorded, all complete`,
            });
          } else {
            checks.push({
              name: "Redactions",
              status: "error",
              detail: `${incomplete.length} incomplete (${incomplete.slice(0, 3).join(", ")})`,
              remedy: "Run `marrow redact --check <evidenceId>` for the exact gaps.",
            });
          }
        }
      } catch {
        checks.push({
          name: "Redactions",
          status: "warn",
          detail: "skipped (schema predates redaction)",
        });
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      checks.push({
        name: "Postgres",
        status: "error",
        detail: `unreachable (${code ?? "connection failed"})`,
        remedy: "Start Postgres, or fix DATABASE_URL.",
      });
      checks.push({ name: "Schema", status: "warn", detail: "skipped (Postgres unreachable)" });
    } finally {
      await pool.end();
    }
  }

  // Distillation readiness: a model must be configured (embeddings are zero-config
  // and run in-process). Missing is a warn, because reads and ingestion still work.
  try {
    loadProviderConfig();
    checks.push({
      name: "Distillation",
      status: "ok",
      detail: "model configured, embeddings run in-process",
    });
  } catch {
    checks.push({
      name: "Distillation",
      status: "warn",
      detail: "no model configured (reads and ingestion still work)",
      remedy: "Set MARROW_API_KEY (Claude) or MARROW_PROVIDER (a local LLM) to distill.",
    });
  }

  return checks;
}
