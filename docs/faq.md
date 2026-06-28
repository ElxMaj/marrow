# FAQ

Plain answers to the questions a developer, PM or CTO actually asks before adopting Marrow. Limitations included, not hidden.

## What is Marrow in one line?

The product context layer for coding agents. It ingests the raw product room (transcripts, standups, interviews, tickets, chat, notes), distills it into product truth with status and provenance, and serves the exact slice your coding agent needs over MCP and a CLI.

## Does Marrow hold our product goals and user goals?

Yes, and that is the point. Marrow is the product source of truth: product goals (what the product must achieve) and user goals (what a user must be able to do) live in the brain as first-class facts, alongside the features and decisions, each tied to the feature it serves and traced to where it was decided. Your team writes a goal directly and it lands as decided, or distillation proposes one from the room as open and a human promotes it in the loop. When new code drifts from a decided goal, Marrow raises a question, it never rewrites the goal from the repo. The room decides the goal, the code reflects it, Marrow watches the gap. Your coding agent reads these goals over MCP (`get_goals`) so it builds toward what the product is actually trying to do. See [source-of-truth.md](./source-of-truth.md).

## How is it different from Granola?

Granola turns meetings into searchable notes. Marrow turns the room into decided facts and open questions, each linked to the exact evidence span, and serves them to your coding agent so it builds from what was actually decided. Granola is a great notes app you read. Marrow is product truth your agent acts on, and it can pull from Granola as one of its connectors. See [compare/granola.md](./compare/granola.md).

## How is it different from Notion or Confluence?

Those are wikis, hand-written pages that go stale. Marrow is distilled from raw evidence, every fact carries a status (open, decided, contested, superseded), and it checks code against decided facts. You write Notion. Marrow derives truth and watches the gap. See [compare/notion.md](./compare/notion.md).

## How is it different from Cursor, or from Lore and Tenet?

Cursor is the coding agent. Marrow is not an agent or an editor, it feeds the agent context. Lore and Tenet are code-rooted, they distill from git and the codebase to answer "what does the code do." Marrow is product-rooted, its input is the room where the product was decided, and it answers "what should the code do and why." We never parse the repo as a source of truth. See [compare/lore-tenet.md](./compare/lore-tenet.md).

## How is it different from Langfuse?

Langfuse is an observability product you run alongside your stack. Marrow has Langfuse-shaped observability built in (latency, tokens, cost, errors, a readable trace) on the same Postgres, no extra service. It is for Marrow's own pipeline, not a general LLM tracer for your whole app. See [observability.md](./observability.md).

## How is it different from Temporal?

Temporal is a workflow engine you deploy. Marrow's sync engine has the Temporal-shaped property that matters here, durable, idempotent, cursor-based pulls that are safe to retry and schedule, on one Postgres with no external workflow engine. It is not a general workflow platform, it is the durable layer for connector syncs. See [connectors.md](./connectors.md).

## Do my transcripts train a model?

No. We do not train any model on your data, and we configure model providers with zero-retention policies where they offer them. The application does not log prompts or completions. See [security.md](./security.md).

## What data leaves my machine?

Only what you send to your chosen model provider for distillation and embeddings, and you pick the provider. Embeddings are zero-config and run in-process by default, so even those need not leave the box. Reads and ingestion work with no model at all. Everything Marrow stores stays in your one Postgres.

## Where are connector secrets stored?

Encrypted at rest. Every connector token or API key is encrypted with AES-256-GCM, using a key derived from `MARROW_SECRET_KEY` that you control, before it ever touches the database. The database holds ciphertext, never plaintext. A database dump on its own cannot leak a token. See [security.md](./security.md).

## Is there a hosted cloud?

This public repo is the open-source, self-hosted product: CLI, MCP server, engine, connectors, local console, docs, and landing source. Hosted product work lives outside this public repo.

## Which tools can it connect to?

Twelve connectors today: Slack, GitHub, Linear, Notion, Figma, Zoom, Intercom, Gmail (email), Microsoft Teams, Jira, Granola and Otter. The last five are new. Each pulls the product-relevant material from that tool as evidence. See [connectors.md](./connectors.md).

## Can I add a connector for a tool you do not support?

Yes. A connector is a small interface, `fetchSince(since)` returns new items as `{ text, source }`. Write one against your tool's API, point it at the sync engine, and it gets the same dedup, cursor and run recording as the built-in ones.

## Does it read my codebase?

Only once, on opt-in onboarding, and only to bootstrap a rough entity list and to ask questions about code that has no product evidence behind it. It never stores code as decided truth. The drift check reads the repo to compare it against decided facts, but a contradiction raises a question, it never overwrites or creates a fact. The room decides, the code reflects, Marrow watches the gap.

## How does the drift catch work?

`marrow drift` scans your git hunks against the decided facts in the brain and flags code that contradicts one, before it reaches main. `marrow drift --ci` posts it as GitHub Actions annotations on a pull request. A catch is always an open question for a human, never an automatic block, and dismissed versus acted-on catches are instrumented so precision improves over time.

## How accurate is the distillation?

Distillation is a model pass, so it is not perfect, and that is exactly why nothing it produces is trusted blindly. It only ever creates nodes as open or proposed with a model confidence. A fact becomes decided only when a human answers a question in the loop. The question loop is the accuracy backstop: the model proposes, the human promotes. Token reduction and catch quality are measured against a synthetic golden set (`marrow benchmark` and `packages/core/fixtures/synthetic-golden.json`), not projected. No partner-data benchmark is claimed until real partner data exists.

## Is evidence really immutable?

Yes, and it is a sacred constraint. Evidence rows are insert-only, never updated, never deleted, no soft-delete flag that hides them. If something needs correcting you append a new row, the old span stays because an existing fact may still cite it. This is what keeps every provenance link pointing at a span that never moved.

## Can I delete data?

Distilled nodes, yes. Raw evidence, no, by design, it is append-only. If you self-host Marrow, you control the database and backups, so deployment-level deletion is your operational policy. See [security.md](./security.md).

## How does it plug into Claude Code or Cursor?

Over MCP. Point your agent at the MCP server package and start with `prepare_task`: it returns the compact task brief with decided goals/decisions, open questions, provenance spans, and safe-to-build vs ask-human-first sections. `maintain_truth` gives the human maintenance brief for goals, proposed goals, contested facts, gap questions, pending catches and connector health. The lower-level task-scoped tools are still there: `search`, `get_decisions`, `get_goals`, `get_open_questions`, `get_entity`, `trace_to_source` (reads, each with status and provenance), plus `append_evidence`, `propose_node` and `check_drift` (shaped writes). Every result tells the agent decided from open and traces to source. The agent can never promote a node to decided, only a human answer does that. Setup is in the [README](../README.md).

## Why does my agent get a slice and not the whole brain?

Context is always task-scoped, on purpose. Dumping the whole brain burns tokens and latency and buries the relevant facts. Task-scoped retrieval is one of the four sacred features and it is never broken to "just include everything."

## What does it cost to run?

Self-host core is free (Apache 2.0). Your only real cost is the model spend for distillation and your Postgres. Reads and ingestion need no model. The dashboard shows an honest cost estimate per run so you can see distillation spend, with unknown models shown as unknown rather than a fake zero.

## What happens when a connector sync fails?

It fails safe. The cursor does not advance, so the next run retries the same window. Anything ingested before the error stays (evidence is append-only, those items are real) and is skipped on retry by the dedup check, so you never get duplicates. The failure is recorded as an `error` run with the message, visible in observability. You retry by running the sync again. See [connectors.md](./connectors.md).

## Is there a UI?

Yes, a console. `npx @marrowhq/cli web` opens it locally. It has sections to browse the brain, settle open questions, watch the automatic data flow from connectors, and read cost, latency and traces. See [console.md](./console.md).

## What is the stack?

TypeScript and Node. One Postgres with pgvector as the single store, graph as tables plus embeddings. Pg-boss for the job queue. No Redis, Kafka, graph database or vector database. Model and embeddings behind a provider interface, default Claude, OpenAI-compatible and local (Ollama, LM Studio) all supported. One Postgres is a hard rule, every extra dependency is a reason someone will not self-host.
