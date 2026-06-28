<div align="center">

# Marrow

**The product context layer for coding agents**

Your coding agent has never been in the room. Marrow puts it there.

[Docs](./docs) · [marrowhq.com](https://marrowhq.com)

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

## Security and trust

See [docs/security.md](./docs/security.md) for architecture, retention, and model-provider policies.

## Access for agents

MCP server and CLI are first class equals. Task scoped tools (`search`, `get_decisions`, `get_goals`, `get_open_questions`, `get_entity`, `trace_to_source`) plus shaped writes (append evidence, propose nodes, check drift). Facts always come back with status and provenance. Fast enough to sit inside an agent loop. The human view of the same brain is the console (`marrow web`), see [docs/console.md](./docs/console.md).

## Stack

- TypeScript everywhere, Node runtime.
- Postgres with pgvector as the single store. Graph as tables plus embeddings in one database.
- Pg-boss for the ingestion and distillation queue. No Redis, Kafka or external broker.
- Official MCP TypeScript SDK for the server.
- Model and embeddings behind a thin provider interface. Default Claude, OpenAI compatible, and local (Ollama / LM Studio) all supported.

## Try it in 60 seconds

```bash
export DATABASE_URL=postgres://marrow:marrow@localhost:5432/marrow   # any Postgres+pgvector
npx @marrowhq/cli demo     # the hero slice end to end, no API key
npx @marrowhq/cli web      # open the console in your browser
```

`demo` ingests an interview, distills it, answers the loop, and shows the magic-link decision decided with provenance back to the exact line, using a scripted model and a local in-process embedding, so it needs no keys. `web` opens the console: browse the brain, settle open questions, watch the connectors flow in, and read cost and latency. The only thing you provide is Postgres. See [docs/console.md](./docs/console.md).

## Prerequisites

- Node >= 20.
- Postgres 16+ with the pgvector extension. `pnpm db:up` starts one in Docker, or point `DATABASE_URL` at any Postgres where `create extension vector` has run.
- **Embeddings are zero-config**: a small model runs in-process the first time you distill (no endpoint, no key, ~25MB one-time download). To use your own embedding endpoint instead (Ollama, or any OpenAI-compatible), set `MARROW_EMBEDDING_BASE_URL`.
- For real distillation you need a model key: `MARROW_API_KEY` for Claude, or `MARROW_PROVIDER=openai-compatible` for a local LLM. Reads and ingestion work with no model at all. See [.env.example](./.env.example).

## Ingest the room

Marrow reads meeting transcripts in the formats your tools already export: WebVTT (Zoom, Meet, Teams), SRT, JSON (Otter, Granola, generic), or plain text/markdown, and normalizes each to clean speaker-attributed evidence before distilling.

```bash
npx @marrowhq/cli ingest ./meetings            # a whole folder, any mix of formats
cat zoom-call.vtt | npx @marrowhq/cli ingest - # or pipe one in
npx @marrowhq/cli ingest --audio standup.m4a   # a voice memo (needs a transcription provider)
npx @marrowhq/cli questions                    # what the room left open
npx @marrowhq/cli ask "passwordless auth"      # task-scoped, semantic
```

(From a clone, run any command with `pnpm marrow ...` instead of `npx @marrowhq/cli ...`.)

## The automatic data flow

The room is bigger than the files you remember to drop. Connectors pull new evidence from the tools where the product actually gets decided, so the brain stays current without you copying anything in. Twelve today:

Slack, GitHub, Linear, Notion, Figma, Zoom, Intercom, and the new ones: Gmail (email), Microsoft Teams, Jira, Granola and Otter.

```bash
export MARROW_SECRET_KEY=...                       # encrypts connector secrets at rest
npx @marrowhq/cli connectors add slack --name slack --secret xoxb-...
npx @marrowhq/cli sync                              # pull every enabled connector now
```

A connector only ever appends evidence, never mutates it. The sync engine is the durable layer: each run pulls only what is new (a cursor per connector), never double-ingests (dedup on append-only evidence), advances the cursor only on success, and records a run. Because every run is idempotent it is safe to retry and safe to schedule, the Temporal-shaped property on one Postgres, no external workflow engine. Secrets are encrypted at rest (AES-256-GCM) before they touch the database. See [docs/connectors.md](./docs/connectors.md).

## See the pipeline

Every distill, search, drift scan and connector sync is recorded as one run on the same Postgres: latency, real token usage when the provider reports it, an honest cost estimate, and errors. The aggregate gives you counts, error rate, p50 and p95 latency, tokens and cost, per kind.

The cost is an estimate, never a bill, and an unknown model shows as unknown, not a fabricated zero. This is the Langfuse-shaped value with no second system to run, the one-Postgres rule again.

```bash
npx @marrowhq/cli runs       # the recent trace
npx @marrowhq/cli observe    # the aggregate metrics
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

Embeddings are zero-config (a local model runs in-process), so no embedding endpoint is required; set `MARROW_EMBEDDING_BASE_URL` only if you want to use your own. For Codex or any other MCP host, use the same command and env as an `mcpServers` entry.

The agent then has `search`, `get_decisions`, `get_open_questions`, `get_entity` and `trace_to_source` (reads, each with status and provenance), plus `append_evidence`, `propose_node`, and `check_drift` (shaped writes). `check_drift` scans the working repo against the room's decided facts and flags code that contradicts one as an open question, the code-time guardrail, so the agent does not build something the room decided against. It can never promote a node to decided; only a human answer does.

## Self host

Open source core, Apache 2.0, self host on nothing but Postgres and one model key. This public repository is the CLI, MCP server, engine, local console, docs, and landing source. Hosted product work is separate from this open-source repo.

## Status

Early, but usable. The core loop is in place: ingest product-room evidence, distill decided vs open product truth with provenance, serve task-scoped context over CLI/MCP, maintain goals, and catch drift against decided facts.

## License

Apache 2.0. See [LICENSE](./LICENSE).
