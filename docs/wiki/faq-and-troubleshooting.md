# FAQ and troubleshooting

When something goes wrong with Marrow, the first move is always the same: run `marrow doctor`. It checks the four things that can break a first run (the database URL, Postgres itself, the schema, and the model configuration) and prints a remedy under each failing check. This page walks every doctor failure and its exact fix, covers the common first-run surprises, and then answers the questions teams ask most often.

## Troubleshooting

### Start with doctor

```bash
pnpm marrow doctor
```

Doctor never throws. It prints one row per check, and sets exit code 3 only if a check is an error. Here is every check, what a failure means, and the fix.

| Check | Failure you see | What it means | Remedy |
| --- | --- | --- | --- |
| DATABASE_URL | `not set` (error) | Marrow does not know where your Postgres is. The Postgres and Schema checks are skipped with warnings until this is fixed. | Point `DATABASE_URL` at your Postgres. From a clone: `pnpm db:up`, then `export DATABASE_URL=postgres://marrow:marrow@localhost:5432/marrow`. You can also put it in `.env`; the CLI reads `./.env` when the variable is unset. |
| Postgres | `unreachable (...)` (error) | The URL is set but nothing answered a `select 1`. The Schema check is skipped. | Start Postgres (`pnpm db:up` in a clone), or fix the host, port, or credentials in `DATABASE_URL`. |
| Schema | `not migrated` or `not migrated (P of N pending)` (error) | The database is reachable but the tables are missing or behind. Doctor compares the repo's migration files against what the database has applied, so it catches partial migrations too. | Run `marrow migrate`. It applies only the pending migrations and prints each one. |
| Distillation | `no model configured (reads and ingestion still work)` (warning) | No model key is set. This is a warning, not an error: it is a supported mode, not a broken install. | Set `MARROW_API_KEY` for Claude, or `MARROW_PROVIDER=openai-compatible` plus `MARROW_BASE_URL` for a local LLM, when you want distillation. |

### Common first-run issues

**DATABASE_URL is not set.** Most commands exit with code 3 and a one-line hint. Postgres is Marrow's one piece of infrastructure, so nothing works without it. The compose file in the repo runs a pgvector-enabled Postgres for you:

```bash
pnpm db:up
export DATABASE_URL=postgres://marrow:marrow@localhost:5432/marrow
```

If you keep the URL in a `.env` file in your working directory, the CLI loads it automatically and prints `Loaded DATABASE_URL from .env`. It never overrides a variable you already exported.

**Schema not migrated.** Errors mentioning a missing relation mean the database exists but has no tables. Run `marrow migrate`. The one exception is `marrow demo`, which sets up its own schema and needs no key at all, so it is the safest way to confirm your install works.

**No model key.** This is keyless mode, not an error. Reads, search, and ingestion all work with only `DATABASE_URL`, because embeddings run in-process with a local model, no endpoint or key needed. Evidence you ingest without a model simply waits in a backlog. When you add a key later, drain it:

```bash
marrow distill --pending
```

The keyless and keyed modes are compared in [Search and retrieval](./search-and-retrieval.md).

## FAQ

### Does Marrow need a graph database?

No. One Postgres 16 or newer with the pgvector extension is the entire infrastructure. No graph database, no Redis, no queue, no daemon. The maintenance loops are CLI commands that a scheduler calls, and the repo ships a GitHub Actions cron template for that (`.github/workflows/maintenance.yml`).

### Can my agent decide things, or delete things?

No, because agents propose and only humans promote or remove. An agent path like `marrow goal propose` creates an open node that must cite evidence; a human promotes it with `marrow answer`, and `marrow retract` is human-only. Nothing agent-facing writes a status, and retracted nodes are kept, never erased.

### What happens to secrets?

Secrets are scrubbed before evidence is stored, because evidence is append-only: a key that reached the insert would be frozen. Detected credentials become visible `[redacted:<kind>]` placeholders, and the ingest receipt reports the count. Connector secrets are encrypted at rest with AES-256-GCM using a key derived from `MARROW_SECRET_KEY`. A command to redact a secret that slipped through is planned but not shipped, so removal of already-stored text happens at your database layer for now. The full detector list, the opt-out, and the workaround steps are in [Trust and safety](./trust-and-safety.md).

### How is this different from Mem0 or Zep?

Those are memory layers; Marrow is a source of truth with statuses, provenance, and a human gate on what becomes decided. It also screens quoted evidence as data and flags instruction-shaped text on quoting surfaces. The full comparison, including what Marrow does not do yet, is in [Mem0 and Zep compared](../compare/mem0-zep.md).

### How is this different from just writing a CLAUDE.md file?

A file is always in context and always paid for, and it cannot hold status, provenance, or contradictions. Marrow retrieves only what a task needs, with provenance. Sometimes the file is the right answer, and the comparison says when: [versus a CLAUDE.md file](../compare/claude-md.md).

### Where do the eval numbers come from?

From Marrow's own eval commands, run in a scratch schema so they never touch your data: `marrow eval` runs a golden set, and `marrow eval --all` runs the full scorecard (retrieval, write quality, temporal, drift catch). The methodology, and why vendor benchmarks are hard to trust, is in [Evaluating agent memory](../evaluating-agent-memory.md). See also [How we measure memory](./measuring-memory.md).

### How do I get help?

Run `marrow doctor` first; every failing check prints its remedy. The repo lives at https://github.com/ElxMaj/marrow, where you can open an issue. For security problems, use GitHub's private vulnerability reporting on the repo rather than a public issue.

## Keep reading

- [Getting started](./getting-started.md)
- [Trust and safety](./trust-and-safety.md)
- [Keeping the brain healthy](./maintenance.md)
