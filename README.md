<div align="center">

# Marrow

**The product context layer for coding agents**

Your coding agent has never been in the room. Marrow puts it there.

[Docs](./docs/wiki/README.md) · [Launch site](https://marrow-six.vercel.app) · [Contributing](./CONTRIBUTING.md)

</div>

---

## What it is

Every standup, whiteboard and user interview holds the why behind your product. None of it reaches your coding agent today, so it guesses. Marrow ingests that raw product room, distills it into structured product truth with sources, and serves the exact slice your agent needs over MCP and a CLI.

The result: the agent builds from what was actually decided, and every requirement it acts on traces back to the exact meeting or interview that created it.

That distilled body is your product's source of truth: the product goals and user goals, the features and how they should behave, each carrying a status and a link to where it was decided. Marrow keeps it current as the product moves, and when code drifts from a decided goal it raises a question instead of letting the source of truth and the codebase quietly diverge.

Token reduction and drift catch quality are measured, not projected. See `marrow benchmark` and the synthetic golden set in `packages/core/fixtures/synthetic-golden.json`. No partner-data benchmark is claimed until real partner data exists.

## How it is different

The space is crowded but everyone else is code rooted. Tools like Lore and Tenet distill from coding sessions, git history and the codebase. They remember the code, they answer why the code is the way it is.

Marrow is product rooted. Its input is the room where the product is decided. It answers what the code should do and why, according to the people and the users. The agent cannot see that room, so it guesses. Marrow removes the guessing.

The others remember your code. Marrow carries the product into it.

## The through-line

The one idea, every fact the agent uses traces back to the room it came from, from a line of code all the way to the moment it was decided. That trace is the whole product. Nail it and the code memory tools cannot easily copy it, their DNA is code, not the room.

## What it is, and is not

**In:** ingesting the raw product room, distilling it into structured knowledge, keeping it fresh, serving task scoped context to agents and to the developer.

**Out:** being the coding agent, an editor, a chat app, a generic notes tool, or a code memory tool that parses the repo. We feed agents from the product side, we are not the agent.

## Knowledge model

A thin fixed spine so the agent always has a stable place to look, with emergent structure on top per team.

- **Evidence**, the raw substrate. Everything dropped is stored verbatim as evidence first, never mutated, always the source for provenance.
- **Entity**, the nouns of the product. Features, components, personas, integrations.
- **Decision**, a settled choice with rationale and status. Hard constraints live here as a tag.
- **Goal**, a target the room committed to. Product goals (what the product must achieve) and user goals (what a user must be able to do), each tied to the feature it serves. This is the product source of truth your agent reads before it builds.
- **Question**, something open or contested.

Every distilled node carries a status (open, decided, contested, superseded), a confidence, and a link to the exact evidence span it came from. The agent must always be able to tell decided from open. That distinction is what stops it confidently building something nobody agreed to.

## The question loop

After ingestion the brain asks the developer when something is ambiguous, contradicts a prior decision, or was referenced but never decided. The developer answers, the answer becomes a high trust node. Without this loop the brain rots into a stale pile of notes, so it is central, not a nice to have.

## Catch drift before it ships

`marrow drift` scans git hunks against decided facts and surfaces contradictions before they reach main. `marrow drift --ci` emits GitHub Actions annotations on pull requests. Dismissed and acted-on catches are instrumented so precision improves over time.

## Comparisons

- [Vs Granola](./docs/compare/granola.md)
- [Vs Notion / Confluence](./docs/compare/notion.md)
- [Vs Lore / Tenet](./docs/compare/lore-tenet.md)
- [Vs Mem0 / Zep](./docs/compare/mem0-zep.md)
- [Vs "just put it in CLAUDE.md"](./docs/compare/claude-md.md)

## Security and trust

See [docs/security.md](./docs/security.md) for architecture, retention, and model-provider policies.

## Access for agents

MCP server and CLI are first class equals. The task loop is explicit:

```bash
marrow loop "implement password login"
marrow loop "implement password login" --check --unstaged
marrow truth
```

`loop` returns the compact agent brief: relevant decided goals and decisions, relevant open or contested questions, exact provenance spans, and clear **safe to build** vs **ask a human first** sections. `--check` also runs drift detection and returns created questions, catch event ids, sanitized receipt data, and accept/dismiss commands.

Over MCP the same surfaces are `prepare_task` and `maintain_truth`, alongside task-scoped tools (`search`, `get_decisions`, `get_goals`, `get_open_questions`, `get_entity`, `trace_to_source`) plus shaped writes (`append_evidence`, `propose_node`, `check_drift`). Facts always come back with status and provenance. The human view of the same brain is the console (`marrow web`), see [docs/console.md](./docs/console.md).

For the copy-paste team ritual, see [docs/agent-workflow.md](./docs/agent-workflow.md) and [templates/AGENTS.marrow.md](./templates/AGENTS.marrow.md).

## The context budget

The context window is metered. Every token your agent loads is paid for on every run, and the tokens that never help still cost you. Two habits quietly drain a project: a standing instruction file that reloads in full every session, and dumping a whole knowledge base into the prompt so the model can hunt for the one fact it needs.

Marrow is built the other way. Your agent instruction file stays short and points at Marrow instead of carrying the room inside it. Then, per task, the agent pulls only the slice it needs. `prepare_task` returns the decided and open facts relevant to that one task, each with provenance, and never the whole brain. The library stays on disk. Only the decisions enter the prompt.

That saving is measured, not projected, and there are two honest numbers, reported separately. On a labeled 12-doc synthetic corpus (`packages/core/fixtures/benchmark/`), a flat task-scoped search loads 2.9x fewer tokens than dumping the corpus, at recall 1.0 on the labeled relevant nodes. The full `prepare_task` brief, the slice an agent actually reads, is richer (decided truth, open questions, provenance) and comes out at 1.5x fewer tokens than the dump. Run `pnpm benchmark` to reproduce both; the committed run lives in `benchmark/report.json`, CI fails if the numbers drift from the code, and [docs/evaluating-agent-memory.md](./docs/evaluating-agent-memory.md) defines every metric and what is not claimed.

## Stack

- TypeScript everywhere, Node runtime.
- Postgres with pgvector as the single store. Graph as tables plus embeddings in one database.
- Distillation runs inline when a model is configured, or on your schedule via `marrow distill --pending`. No Redis, Kafka, queue service or external broker.
- Official MCP TypeScript SDK for the server.
- Model and embeddings behind a thin provider interface. Default Claude, OpenAI compatible, and local (Ollama / LM Studio) all supported.

## Try it in 60 seconds

The only thing you provide is Postgres. `pnpm db:up` starts one in Docker; or point `DATABASE_URL` at any Postgres with pgvector.

```bash
# 0. a Postgres with pgvector (skip if you already have one)
docker run -d --name marrow-pg -p 5432:5432 \
  -e POSTGRES_USER=marrow -e POSTGRES_PASSWORD=marrow -e POSTGRES_DB=marrow \
  pgvector/pgvector:pg16
export DATABASE_URL=postgres://marrow:marrow@localhost:5432/marrow

# 1. the hero slice end to end, no API key (sets up its own schema)
npx @marrowhq/cli demo

# 2. open the console in your browser
npx @marrowhq/cli migrate   # schema for everything other than demo
npx @marrowhq/cli web
```

`demo` ingests an interview, distills it, answers the loop, and shows the free-trial decision decided with provenance back to the exact line, using a scripted model and a local in-process embedding, so it needs no keys. `web` opens the console: browse the brain, settle open questions, watch the connectors flow in, and read cost and latency. See [docs/console.md](./docs/console.md).

Prefer to work from source? Clone and use the workspace scripts instead:

```bash
git clone https://github.com/ElxMaj/marrow && cd marrow
pnpm install
pnpm db:up && pnpm db:migrate
export DATABASE_URL=postgres://marrow:marrow@localhost:5432/marrow
pnpm marrow demo
pnpm marrow web
```

Run `marrow doctor` (or `pnpm marrow doctor`) any time to check the whole stack at a glance: DATABASE_URL, Postgres reachability, schema, and whether a model is configured for distillation. Each failing check prints what to run next.

## Prerequisites

- Node >= 20.
- Postgres 16+ with the pgvector extension. `pnpm db:up` starts one in Docker, or point `DATABASE_URL` at any Postgres where `create extension vector` has run.
- **Embeddings are zero-config**: a small model runs in-process, with or without a model key, so search is semantic out of the box (no endpoint, no key, ~25MB one-time download on first use). Set `MARROW_LOCAL_EMBEDDINGS=0` to skip the download and stay lexical-only, or `MARROW_EMBEDDING_BASE_URL` to use your own embedding endpoint (Ollama, or any OpenAI-compatible).
- For real distillation you need a model key: `MARROW_API_KEY` for Claude, or `MARROW_PROVIDER=openai-compatible` for a local LLM. Reads and ingestion work with no model at all. See [.env.example](./.env.example).

## Ingest the room

Marrow reads meeting transcripts in the formats your tools already export: WebVTT (Zoom, Meet, Teams), SRT, JSON (Otter, Granola, generic), or plain text/markdown, and normalizes each to clean speaker-attributed evidence before distilling.

```bash
pnpm marrow ingest ./meetings            # a whole folder, any mix of formats
cat zoom-call.vtt | pnpm marrow ingest - # or pipe one in
pnpm marrow ingest --audio standup.m4a   # a voice memo (needs a transcription provider)
pnpm marrow questions                    # what the room left open
pnpm marrow ask "passwordless auth"      # task-scoped, semantic
```

## The automatic data flow

The room is bigger than the files you remember to drop. Connectors pull new evidence from the tools where the product actually gets decided, so the brain stays current without you copying anything in. Twelve today:

Slack, GitHub, Linear, Notion, Figma, Zoom, Intercom, and the new ones: Gmail (email), Microsoft Teams, Jira, Granola and Otter.

```bash
export MARROW_SECRET_KEY=...                       # encrypts connector secrets at rest
pnpm marrow connectors add slack --name slack --secret xoxb-...
pnpm marrow sync                              # pull every enabled connector now
```

A connector only ever appends evidence, never mutates it. The sync engine is the durable layer: each run pulls only what is new (a cursor per connector), never double-ingests (dedup on append-only evidence), advances the cursor only on success, and records a run. Because every run is idempotent it is safe to retry and safe to schedule, the Temporal-shaped property on one Postgres, no external workflow engine. Secrets are encrypted at rest (AES-256-GCM) before they touch the database. See [docs/connectors.md](./docs/connectors.md).

## See the pipeline

Every distill, search, drift scan and connector sync is recorded as one run on the same Postgres: latency, real token usage when the provider reports it, an honest cost estimate, and errors. The aggregate gives you counts, error rate, p50 and p95 latency, tokens and cost, per kind.

The cost is an estimate, never a bill, and an unknown model shows as unknown, not a fabricated zero. This is the Langfuse-shaped value with no second system to run, the one-Postgres rule again.

```bash
pnpm marrow runs       # the recent trace
pnpm marrow observe    # the aggregate metrics
```

See [docs/observability.md](./docs/observability.md).

## Connect to Claude Code or Codex

Marrow serves task-scoped context to your coding agent over MCP. Point Claude Code at the published server:

```bash
claude mcp add marrow \
  -e DATABASE_URL=postgres://marrow:marrow@localhost:5432/marrow \
  -e MARROW_API_KEY=sk-ant-... \
  -- npx -y @marrowhq/mcp-server
```

Works with Claude Code, Cursor, Codex, or any MCP host: use the same command and env as an `mcpServers` entry. Contributing to the server itself? Run it from source instead: `-- pnpm --dir /ABSOLUTE/PATH/TO/marrow exec tsx packages/mcp-server/src/main.ts`.

Embeddings are zero-config (a local model runs in-process), so no embedding endpoint is required; set `MARROW_EMBEDDING_BASE_URL` only if you want to use your own.

The agent then starts with `prepare_task` for its task brief and can call `maintain_truth` when a human wants the source of truth health. It still has `search`, `get_decisions`, `get_goals`, `get_open_questions`, `get_entity` and `trace_to_source` (reads, each with status and provenance), plus `append_evidence`, `propose_node`, and `check_drift` (shaped writes). `check_drift` scans the working repo against the room's decided facts and flags code that contradicts one as an open question, the code-time guardrail, so the agent does not build something the room decided against. It can never promote a node to decided; only a human answer does.

### Wire it into a project

Point any project at Marrow with three lines in its `CLAUDE.md`, `AGENTS.md`, or equivalent agent instruction file:

```markdown
## Product context (Marrow)
- Before any task, call prepare_task (or run `marrow loop "<task>"`) for decided vs open product truth with provenance.
- Build only on decided facts. For open or contested ones, ask a human. Never infer product intent from the code.
```

That is enough to start. For the full team ritual, paste [templates/AGENTS.marrow.md](./templates/AGENTS.marrow.md).

## Self host

Open source core, Apache 2.0, self host on nothing but Postgres and one model key. This public repository is the CLI, MCP server, engine, local console, docs, and landing source. Hosted product work is separate from this open-source repo.

## Status

Early, but usable. The core loop is in place: ingest product-room evidence, distill decided vs open product truth with provenance, serve task-scoped context over CLI/MCP, maintain goals, and catch drift against decided facts.

Launch operations live in [docs/launch.md](./docs/launch.md). `pnpm launch:preflight` checks npm, GitHub, Vercel, DNS, benchmark claims, and package allowlists before a public push.

## License

Apache 2.0. See [LICENSE](./LICENSE).
