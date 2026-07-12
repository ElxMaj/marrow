# CLI reference

Every Marrow command, grouped by the job you are trying to do. The general shape is `marrow <command> [args] [--json]`. Add `--json` to any command when you want raw JSON for scripting, and `--no-distill` when you want to capture text without running the model. `-h` shows help and `-v` shows the version. One rule underpins everything: the CLI can never mark something decided directly. Only `answer` and `goal author` promote to decided, and both go through core.

## Set up

### marrow migrate
Run this first, and again after every upgrade. It applies pending schema migrations to the Postgres database in `DATABASE_URL` and prints each applied migration, or "Schema is up to date."

```bash
marrow migrate
```

### marrow doctor
Reach for this when anything feels off. It checks `DATABASE_URL`, Postgres reachability, schema state, and whether a distillation model is configured, with a remedy printed under each failing check. A missing model is only a warning: reads and ingestion still work without one.

```bash
marrow doctor --json
```

### marrow demo
A guided tour that needs no API key. It self-migrates, then runs the full loop (ingest, question, decision, trace, agent answer) against a bundled interview using a scripted model and deterministic embeddings.

```bash
marrow demo
```

### marrow init
Point Marrow at a repository for the first time. It scans the code and opens questions rather than asserting facts: it asks, never asserts.

```bash
marrow init ./my-repo
```

## Capture

### marrow ingest
The main door in. Give it a file, a directory (it sweeps `.vtt .srt .json .txt .md .markdown .text` recursively), or `-` for stdin. It normalizes transcripts, scrubs secrets when scrubbing is on, and distills by default.

```bash
marrow ingest ./meetings/standup.vtt --source "zoom"
```

Audio and images have their own paths through the same command:

```bash
marrow ingest --audio ./call.m4a
marrow ingest --image ./whiteboard.png
```

### marrow watch
Leave this running against a folder your tools drop files into. It stays resident until you stop it, ingesting new files after a debounce (default 2000 ms).

```bash
marrow watch ./exports --debounce 5000
```

### marrow import
For existing docs. It sweeps `.md .mdx .txt .markdown .text` files; CLAUDE.md, DECISIONS.md, and AGENTS.md are tagged as repo docs so their provenance stays legible.

```bash
marrow import ./docs
```

### marrow add
Quick one-off capture of a single file or stdin.

```bash
echo "We agreed to keep soft deletes." | marrow add --source "slack"
```

### marrow connectors and marrow sync
Connect the tools where knowledge already lives: slack, github, linear, notion, figma, zoom, intercom, email, teams, jira, granola, otter. Secrets are encrypted at rest, which requires `MARROW_SECRET_KEY`. `connectors` lists sync state, `sync` pulls one connector or all enabled ones. Removing a connector keeps its evidence. Per-service setup (tokens, scopes, scheduling, and failure modes) is covered in [the connectors guide](../connectors.md).

```bash
marrow connectors add slack --name team-slack --secret xoxb-...
marrow sync team-slack
```

## Distill

### marrow distill
Distillation turns raw evidence into structured, linked knowledge. Ingest does this automatically, so you reach for `distill` when evidence piled up without a model configured. `--pending` drains the backlog (default limit 50) and reports what remains.

```bash
marrow distill --pending --limit 100
```

## Read

### marrow ask
Semantic search over everything Marrow knows. This is the everyday query.

```bash
marrow ask "why did we choose soft deletes"
```

### marrow decisions, goals, questions
List what has been decided, what you are aiming at, and what is still open (most consequential first). `decisions` and `goals` filter by status (`open`, `decided`, `contested`, `superseded`, `retracted`); `goals` also filters by `--type product|user`.

```bash
marrow decisions --status contested
marrow questions
```

### marrow entity, trace, neighbors, map, history
Drill into the graph. `entity` fetches one entity by id or name. `trace` prints the exact verbatim source span behind a node, which is how you audit any claim. `neighbors` walks the graph from a node (default 1 hop), `map` prints every node most-connected-first (default limit 200), and `history` shows a node's supersedes lineage, oldest first.

```bash
marrow trace node_123
marrow neighbors node_123 --hops 2
```

## Decide

### marrow answer
The human promotion path. Answer an open question, optionally deciding a specific proposed node with `--decide`.

```bash
marrow answer q_42 --text "Yes, soft deletes stay." --decide node_123
```

### marrow goal author and marrow goal propose
`author` is the only way a human creates a decided node directly. `propose` is the agent path: it requires `--evidence` so every proposal carries provenance, and it lands as open, never decided.

```bash
marrow goal author "Ship self-serve onboarding" --type product
marrow goal propose "Users want CSV export" --type user --evidence ev_9
```

### marrow retract
Human-only removal. The node is kept and marked retracted with your reason, never erased.

```bash
marrow retract node_123 --reason "Superseded by the new billing plan"
```

## Maintain

### marrow loop
Run this before starting a task. It prints a task brief: what is safe to build, what to ask a human first, relevant raw evidence, and a drift check against your working tree (scope defaults to unstaged changes).

```bash
marrow loop "add CSV export" --staged
```

### marrow drift
Checks whether code changes contradict decided knowledge. In CI, `--ci` emits GitHub file and line annotations and exits nonzero when drift is found.

```bash
marrow drift --since main --ci
```

### marrow truth, verify, lint, synthesize
Routine upkeep. `truth` prints a product truth brief (decided items, contested items, gaps, backlog, connector health, next actions). `verify` runs a skeptic pass over open model-proposed facts and flags weak ones. `lint` finds duplicates, contradictions, and dead edges. `synthesize` writes a change digest (default 7 days).

```bash
marrow truth
marrow synthesize --days 14
```

### marrow dismiss and marrow accept
Close the loop on drift catches: `dismiss` marks one as noise with a reason, `accept` records that you acted on it. Both feed the precision numbers in `metrics`.

```bash
marrow dismiss q_7 --reason "Intentional, covered by the migration plan"
```

## Measure

### marrow metrics, runs, observe
`metrics` reports surfaced, acted on, and dismissed catches, plus precision and dismiss rate. `runs` lists recent pipeline runs with latency, tokens, and cost. `observe` aggregates them (p50 and p95 latency, errors, cost by kind).

```bash
marrow metrics --since 2026-06-01
marrow observe
```

### marrow eval and marrow benchmark
`eval` runs a golden-set evaluation in a throwaway scratch schema; `eval --all` runs the full scorecard (retrieval, write quality, temporal, drift catch). `benchmark` measures token reduction from using the brief. None of these touch your real data.

```bash
marrow eval --all
```

## Serve

### marrow web
The human console in your browser: answer questions, browse the graph, watch connectors and pipeline metrics. It binds to localhost by default and ships no auth of its own; see [the console guide](../console.md). Port comes from `--port`, then the `PORT` variable, then 8787.

```bash
marrow web --open --port 3000
```

## Environment variables

The CLI reads `./.env` for `DATABASE_URL` when it is not already set in your shell.

| Variable | What it does |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. The one required piece of infrastructure. |
| `PORT` | Default port for `marrow web` when `--port` is absent (fallback 8787). |
| `MARROW_PROVIDER` | `claude` (default) or `openai-compatible`. |
| `MARROW_API_KEY` | Required for the claude provider. |
| `MARROW_BASE_URL` | Required for openai-compatible, for example Ollama at `http://localhost:11434/v1`. |
| `MARROW_MODEL` | Model id. Defaults for claude; required for openai-compatible. |
| `MARROW_EMBEDDING_MODEL` | Embedding model name. |
| `MARROW_EMBEDDING_BASE_URL` / `MARROW_EMBEDDING_API_KEY` | Remote embedding endpoint. Without a base URL, a zero-config in-process local embedder is used. |
| `MARROW_LOCAL_EMBEDDING_MODEL` | Override for the local embedding model. |
| `MARROW_TRANSCRIPTION_MODEL` | Audio transcription model. |
| `MARROW_SCRUB=off` | Explicit opt-out of secret scrubbing. Anything else means on. |
| `MARROW_SECRET_KEY` | Encryption key for connector secrets at rest. Required to store connector secrets. |
| `MARROW_FACT_TTL_DAYS` | If set to a positive number, promoted facts get an expiry that many days out. |
| `MARROW_STALE_DAYS` | Staleness window for decided nodes (default 365). |
| `MARROW_DUP_DISTANCE` | Near-duplicate embedding distance threshold (default 0.15). |
| `FORCE_COLOR`, `NO_COLOR`, `TERM=dumb` | Control colored output. |

## Keep reading

- [Getting started](./getting-started.md)
- [Search and retrieval](./search-and-retrieval.md)
- [Keeping the brain healthy](./maintenance.md)
