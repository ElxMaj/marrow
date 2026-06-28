# Observability

Marrow runs a pipeline: it distills evidence into facts, searches the brain, scans for drift, and pulls from connectors. When that pipeline is a black box you cannot answer the basic questions, what did it cost, what is slow, what is failing. Observability makes every one of those operations visible, without bolting on a second system.

## A run is one operation, recorded once

Every model call, retrieval, drift scan, connector sync and ingest is wrapped in `traced()`, which records exactly one row in the `run` table when the operation finishes. A run captures:

- **Kind**: `distill`, `search`, `drift`, `connector_sync`, or `ingest`
- **Status**: `ok` or `error`, with the error message when it threw
- **Latency**: measured around the operation
- **Model**: the model id, when a model was involved
- **Tokens**: real input and output token counts, when the provider reports them
- **Cost**: an estimate (see below)
- **Summaries**: a short input and output summary so a trace reads like a story
- **Label, parentId, metadata**: a name, a link to a parent run, and any extra context (a connector sync records items ingested and skipped here)

A run is append-only. It is written once at completion and never mutated, the same discipline as a log line. It is not evidence, but like evidence it does not move under you once recorded.

Recording is best-effort: if writing a run ever fails, it never masks the real result or the real error of the operation it was measuring. Telemetry never breaks the thing it measures.

## What the pipeline records

- **Distill**: the model and tokens for an extraction pass, its latency, and a summary of what came out.
- **Search**: a retrieval. A keyword search has no model and no tokens, it just records a count and the latency. A semantic search records the embedding work.
- **Drift**: a scan of repo hunks against decided facts, its latency and what it flagged.
- **Connector_sync**: one connector pull, with items ingested and skipped, latency, and any error. This is what makes the automatic data flow auditable. See [connectors.md](./connectors.md).
- **Ingest**: an evidence drop.

## The metrics

Over any window you get an aggregate rollup:

- **Count** and **error count**, so you can read an error rate
- **P50 and p95 latency**, the honest tail, not just an average that hides the slow ones
- **Total tokens in and out**
- **Total estimated cost**
- **ByKind**: the same numbers (count, error count, cost, average latency) broken out per kind, so you can see distillation cost separately from search latency

```bash
marrow runs                       # the recent trace, newest first
marrow runs --kind distill        # filter by kind
marrow runs --status error        # only failures
marrow observe                    # the aggregate metrics
marrow observe --since 2026-06-01T00:00:00Z
```

The console shows the same trace and metrics on a screen. See [console.md](./console.md).

## The cost number is an estimate, and says so

The cost on a run is an estimate, never a bill. It multiplies the token counts by approximate public list prices, keyed by a substring of the model id (opus, sonnet, haiku, the common OpenAI families). The prices drift over time and your real invoice depends on your contract, so treat this as a dashboard signal, not accounting.

The important part is the honesty: an unknown or unpriced model returns no cost at all, not a zero. The dashboard shows "unknown" instead of a confident, wrong zero that would make you think a run was free. A fabricated zero is worse than an honest gap. If a caller passes a real cost from the provider, that is used as-is and the estimate is skipped.

## Why this lives on one Postgres

This is the value you would otherwise reach for Langfuse to get: latency, tokens, cost, errors, and a trace you can read. Marrow gives you that on the same Postgres the graph already lives in, as one more table. No second service to run, no data shipped to a third party, no extra bill.

That is not an accident, it is the one-Postgres rule. Every extra dependency is a reason someone will not self-host. Observability shaped like Langfuse, durability shaped like Temporal, the graph and the vectors, all in one database you already run. The pipeline is measurable without making the stack harder to stand up.
