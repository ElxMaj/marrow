# The console

The console is the screen for the brain. The CLI and the MCP server are for the agent and the terminal; the console is for a human who wants to see what the brain knows, settle what it does not, watch the data flowing in, and read what the pipeline cost and how fast it ran. It is a thin window onto core, no product logic of its own.

## How to open it

```bash
npx @marrowhq/cli web        # local, opens the console in your browser
npx @marrowhq/cli web --open # and launches the browser for you
```

From a clone, `pnpm marrow web`. It stays up until you stop it with Ctrl+C. The only thing it needs is your Postgres.

## The sections

The console is organized into sections, each answering one question about the brain. It describes what each section is for; the exact layout is still settling.

- **Overview**: the state of the brain at a glance. How many decided facts, how many open questions waiting on a human, recent activity, the health of the automatic data flow. The place you land.
- **Questions**: the question loop. The open and contested questions the room left behind, most consequential first. You answer here, and your answer is the human promote-to-decided step that turns a proposed node into a decided one. This is the section that keeps the brain from rotting into stale notes.
- **Graph**: the distilled graph. Browse the entities, decisions, goals and questions, each with its status and a trace back to the exact evidence span it came from. Decided versus open is always legible, never blurred.
- **Goals**: the product's source of truth, product goals and user goals. Your team writes a goal here and it lands as decided, distillation proposes goals from the room as open, and each goal carries its status, the feature it serves, its confidence and a trace to where it was decided. An open goal is settled in the question loop, the same human promote-to-decided step. When code drifts from a decided goal it comes back as a question, never a silent rewrite. This is where the room and the code are kept honest with each other.
- **Connectors**: the automatic data flow. Which connectors are configured, whether each is enabled, when it last ran, how many items it pulled, and its health. Configure, enable or disable, and trigger a sync. Secrets are encrypted before they are stored and never shown back. See [connectors.md](./connectors.md).
- **Observability**: the pipeline, measured. The run trace (distill, search, drift, connector sync, ingest) and the aggregate metrics, latency at p50 and p95, tokens, an honest cost estimate, and the error rate, broken out per kind. Unknown-model cost shows as unknown, not a fake zero. See [observability.md](./observability.md).
- **Ingest**: drop the room in by hand. Paste or upload a transcript, a doc or a note as evidence, for the times you are not pulling it through a connector.
- **Settings**: configuration for the brain, the model, and the embedding provider.

## What it is not

The console is not the coding agent and not an editor. It does not write your product truth for you; it shows you what the room decided, lets you settle what is open, and lets you watch and measure the flow. The agent gets the same brain over MCP, task-scoped. The console is the human's view of the same store.
