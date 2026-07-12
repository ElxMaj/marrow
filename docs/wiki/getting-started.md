# Getting started

This page gets you from an empty terminal to a working Marrow brain in about 15 minutes. You will clone the repo, start a Postgres, run the migrations, check your setup with `marrow doctor`, ingest your first document, look at what Marrow made of it, and wire the result into your coding agent. Everything on this page except distillation (the model step that turns raw text into structured facts) works with no API key at all.

## Prerequisites

You need three things:

- Node.js 20 or newer, with pnpm as the package manager.
- Docker, if you want Marrow to run Postgres for you. If you already have a Postgres 16 or newer with the pgvector extension, you can skip Docker entirely.
- Optionally, a model key for distillation. Reads and ingestion work without one.

That is the whole infrastructure list. Marrow runs on one Postgres with pgvector. There is no graph database, no Redis, no queue, and no daemon. The maintenance loops are CLI commands that a scheduler (GitHub Actions cron or system cron) calls.

## Install

The npm packages are `@marrowhq/cli` and `@marrowhq/mcp-server`, but the currently published build is behind this repository and lacks `doctor` and the newer error remedies. So the recommended path today is a clone:

```bash
git clone https://github.com/ElxMaj/marrow && cd marrow
pnpm install
```

From inside the clone, `pnpm marrow <command>` runs the CLI from source. Everywhere this page says `marrow`, run `pnpm marrow`.

## Get a Postgres

From the clone, one command starts a ready-to-go database in Docker:

```bash
pnpm db:up
```

This runs Docker Compose with the `pgvector/pgvector:pg16` image, a `marrow` user, password, and database, on port 5432. Data lives in `./.pgdata`, and `pnpm db:down` stops it.

Bringing your own database is fine too. Any Postgres 16 or newer works, as long as the pgvector extension is available.

## Point Marrow at it

Marrow finds the database through one environment variable:

```bash
export DATABASE_URL=postgres://marrow:marrow@localhost:5432/marrow
```

That URL matches the Compose setup above, and it is the default in `.env.example`. If you brought your own Postgres, use its URL instead.

You do not have to export it every time. If `DATABASE_URL` is not set, the CLI looks for a `.env` file in the current directory and loads it, printing `Loaded DATABASE_URL from .env` so you know where the value came from. It never overrides a variable you already set. For the rest of the optional variables, copy `.env.example` to `.env.local` (gitignored) and fill in what you need.

## Migrate

Create the schema:

```bash
pnpm marrow migrate
```

It applies any pending migrations and prints `Applied <name>` for each, or `Schema is up to date.` if there is nothing to do. Run it again after pulling new code; it is safe to repeat. (`pnpm db:migrate` is a repo shortcut for the same thing; other pages use the two interchangeably.)

## Check your setup with doctor

```bash
pnpm marrow doctor
```

Doctor prints one line per check, with a dim remedy under anything that fails. The four checks, in order: is `DATABASE_URL` set, is Postgres reachable, are all migrations applied, and is a distillation model configured. The first three are hard errors with the fix printed under each; the model check is only a warning, because reads and ingestion work fine without one. The command exits with code 3 if any check is a hard error, so you can also use it in scripts. The failure-by-failure table is in [FAQ and troubleshooting](./faq-and-troubleshooting.md).

## Your first ingest

Feed Marrow a file:

```bash
pnpm marrow add ./notes/kickoff.md --source "kickoff meeting"
```

`add` takes one file (or stdin) and stores it as evidence, a verbatim source record. If a model is configured, Marrow distills it inline: it extracts decisions, goals, questions, and entities as structured nodes, each linked back to the exact span of text it came from. With no model, the evidence is stored and queued; drain the backlog later with `pnpm marrow distill --pending` once you have a key. For a folder of meeting transcripts, use `pnpm marrow ingest ./meetings`, which sweeps the directory recursively.

If you just want to see the whole pipeline before touching your own data, `pnpm marrow demo` runs a scripted end-to-end slice (ingest, distill, answer) with no key and its own schema.

## First look at the brain

Two commands show you what Marrow now knows:

```bash
pnpm marrow map
pnpm marrow truth
```

`map` lists every node in the knowledge graph, most-connected first, so you see what the brain considers central. `truth` is the product truth brief: decided goals and decisions, open questions, contested facts, gaps, and suggested next actions. Also worth trying early: `pnpm marrow ask "why did we choose soft delete"` for semantic search, and `pnpm marrow trace <nodeId>` to see the verbatim source span behind any fact. For a browser view, `pnpm marrow web` opens the local console.

## Wire it into your agent

Add these three lines to your agent instruction file (`CLAUDE.md`, `AGENTS.md`, or equivalent):

```markdown
## Product context (Marrow)
- Before any task, call prepare_task (or run `marrow loop "<task>"`) for decided vs open product truth with provenance.
- Build only on decided facts. For open or contested ones, ask a human. Never infer product intent from the code.
```

`prepare_task` is the MCP tool version of the CLI's `marrow loop` command; both return a task brief that separates what is safe to build on from what needs a human. For the fuller ritual, paste `templates/AGENTS.marrow.md` instead.

## Keyless versus keyed

Without any model key, you get: all reads (`ask`, `map`, `truth`, `questions`, `decisions`, `trace`), all ingestion, `migrate`, `doctor`, `web`, and `demo`. Embeddings need no key either: Marrow runs a local in-process model (`Xenova/all-MiniLM-L6-v2`, roughly a 25MB one-time download).

A model key unlocks real distillation. Set `MARROW_API_KEY` for Claude (the default provider), or `MARROW_PROVIDER=openai-compatible` plus `MARROW_BASE_URL` for a local LLM through Ollama or LM Studio. Audio ingestion (`marrow ingest --audio`) additionally needs a transcription provider.

## Keep reading

- [Core concepts](./core-concepts.md): what evidence, nodes, statuses, and provenance mean.
- [Working with agents](./working-with-agents.md): the loop command, the MCP server, and the wire-in ritual in depth.
- [CLI reference](./cli-reference.md): every command and flag.
