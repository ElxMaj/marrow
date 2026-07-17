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
  env: NodeJS.ProcessEnv = process.env,
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
  let modelConfigured = true;
  try {
    loadProviderConfig();
    checks.push({
      name: "Distillation",
      status: "ok",
      detail: "model configured, embeddings run in-process",
    });
  } catch {
    modelConfigured = false;
    checks.push({
      name: "Distillation",
      status: "warn",
      detail: "no model configured (reads and ingestion still work)",
      remedy: "Set MARROW_API_KEY (Claude) or MARROW_PROVIDER (a local LLM) to distill.",
    });
  }

  // The undistilled backlog: evidence that never became facts is the most
  // likely first-run confusion (ingest worked, nothing appeared). Count it so
  // the user learns it from doctor instead of from an empty question loop.
  if (databaseUrl) {
    const pool = new pg.Pool({ connectionString: databaseUrl });
    try {
      const res = await pool.query<{ n: number }>(
        "select count(*)::int as n from evidence e where not exists (select 1 from provenance p where p.evidence_id = e.id)",
      );
      const n = res.rows[0]?.n ?? 0;
      if (n === 0) {
        checks.push({ name: "Backlog", status: "ok", detail: "no undistilled evidence" });
      } else {
        checks.push({
          name: "Backlog",
          status: "warn",
          detail: `${n} evidence row${n === 1 ? "" : "s"} never distilled into facts`,
          remedy: modelConfigured
            ? "Run `marrow distill <evidenceId>` (ids via `marrow evidence`), or re-ingest with distillation on."
            : "Set MARROW_API_KEY (Claude) or MARROW_PROVIDER (a local LLM), then `marrow distill <evidenceId>`.",
        });
      }
    } catch {
      // schema missing or unreachable: already reported by the checks above.
    } finally {
      await pool.end();
    }
  }

  // Connector secrets: MARROW_SECRET_KEY encrypts them before they touch the
  // database. Only warn when it actually matters (a connector is configured
  // but the key is missing or too short to be a real secret), so a user who
  // never touches connectors is not nagged.
  if (databaseUrl) {
    const pool = new pg.Pool({ connectionString: databaseUrl });
    try {
      const res = await pool.query<{ n: number }>(
        "select count(*)::int as n from connector_config",
      );
      const connectors = res.rows[0]?.n ?? 0;
      const key = env.MARROW_SECRET_KEY;
      if (connectors === 0) {
        checks.push({
          name: "Connector secrets",
          status: "ok",
          detail: key ? "MARROW_SECRET_KEY set" : "no connectors configured",
        });
      } else if (!key || key.length < 16) {
        checks.push({
          name: "Connector secrets",
          status: "warn",
          detail: `${connectors} connector(s) configured but MARROW_SECRET_KEY is ${key ? "too short" : "unset"}`,
          remedy:
            "Set MARROW_SECRET_KEY to a long random string; connector syncs cannot decrypt their tokens without it.",
        });
      } else {
        checks.push({
          name: "Connector secrets",
          status: "ok",
          detail: `${connectors} connector(s), MARROW_SECRET_KEY set`,
        });
      }
    } catch {
      // no connector table (schema not migrated): the Schema check owns that.
    } finally {
      await pool.end();
    }
  }

  return checks;
}
