# Marrow vs Mem0 / Zep

Mem0 and Zep are memory layers for conversational agents: they remember what a
user said so the next chat feels continuous. Marrow is a product-context layer
for coding agents: it remembers what the team decided, with the exact span it
came from, and serves a task-scoped slice of that truth before the agent
builds. Different jobs, and the differences that matter live on the write
side, in time, and in trust. Every claim below cites a shipped mechanism or a
number from the committed scorecard ([benchmark/report.json](../../benchmark/report.json),
reproduced by `marrow eval --all`; the metrics are defined in
[evaluating-agent-memory.md](../evaluating-agent-memory.md)).

## The write side is the side that fails

A public audit of one Mem0 deployment found 97.8 percent of 10,134
auto-captured memories were junk: duplicates, malformed entries, hallucinated
attributes, transient details stored as durable
(github.com/mem0ai/mem0/issues/4573). That is not a Mem0 bug so much as the
default outcome of write-anything memory. Marrow's answer maps a gate onto
each junk class, and measures it:

| Junk class | Marrow's gate | Measured |
| --- | --- | --- |
| Hallucinated attributes | Every distilled item must carry a verbatim quote; an unresolvable quote drops the item before storage | false-memory rate gated at exactly 0 |
| Duplicates | Write-time merge for restated entities, decisions, and goals (the pre-existing node always survives); paraphrase pairs get an advisory edge plus one question; `marrow lint` sweeps semantic near-duplicates on a schedule | duplicate rate under re-ingestion: 0 |
| Transient details stored as durable | A tentative leaning becomes a question, never a decision; the extraction policy (`.marrow/policy.json`) drops calendar chatter and named categories deterministically before insert | write precision and recall gated at or above 0.8 |
| Junk that slips through anyway | The skeptic (`marrow verify`) attacks proposals (single source, weak provenance, contradicts decided, instruction smell); `marrow retract` is the human-only correction; nothing agent-facing writes any status | agent proposes, human promotes: only the human answer loop writes decided |

Mem0's own docs advise calling `add` only for reusable information. Marrow
does not rely on caller discipline: the gates run on every write path,
including the MCP tools an agent drives.

## Temporal truth, versus Zep

Zep's headline strength is the temporal graph: facts have validity windows and
replaced facts stay historically available. Marrow holds the same story in
one Postgres and shows it: every conflict resolution records a supersedes
edge with the date and the human answer that justified it, `marrow history`
lays out the lineage from any link in the chain, and the weekly digest says
"B replaced A on this date because this answer." Measured: current-state
accuracy 1.0 (every surface serves the winner) and historical accuracy 1.0
(the loser stays fully reachable with its content and provenance).
Invalidation, not erasure, on both products; Marrow's version runs on an edge
table and a recursive CTE instead of a hosted graph service.

## Read-after-write

Zep's documented failure mode (github.com/getzep/graphiti/issues/356): you
tell the agent something, async graph ingestion has not finished, the agent
immediately forgets. Marrow distills synchronously (a returned write is a
readable write, measured as ingestion-ready p95 in the scorecard), the MCP
append tool distills inline by default, and anything deferred surfaces in the
next task brief anyway through the session buffer, labeled raw and capped.
The backlog is always visible (`marrow truth`) and drainable
(`marrow distill --pending`).

## Instructions inside memory

Both Mem0 and Zep store whatever the conversation contained, and neither
ships protection against instructions embedded in retrieved memory. Marrow
frames every quoted span as data (server instructions, tool banners, CLI
labels), detects instruction-shaped spans at read time, in audits, and in the
skeptic, clamps giant quotes in briefs, and scrubs credential-shaped text
before the append because evidence is immutable afterward. None of the
vendors studied ship any of this.

## Cost and operations

One Postgres with pgvector. No graph database, no queue service, no daemon;
scheduling is cron calling a CLI. Self-hosting Zep means Graphiti plus a
graph database plus everything around it (Zep's own comparison says so);
Mem0 self-hosting is real but the write-quality audit above happened on a
self-hosted deployment. Marrow is the same single datastore in dev, CI, and
production, and the whole eval suite runs against it keyless.

## What Marrow does not do yet

Stated plainly, per the house honesty rule:

- Deletion completeness for secrets is not shipped: evidence is append-only
  by design, secrets are scrubbed BEFORE the append, and the human-only
  redaction command for anything that slips through is built and awaiting
  founder sign-off (roadmap R26), because it visibly amends the append-only
  rule.
- No per-user or per-session memory scoping (Mem0's user_id/run_id model).
  Marrow is per-brain, one product per database, and that is deliberate.
- No hosted cloud. You bring Postgres.
- The skeptic is rule-based today; the model-based deep pass is a noted
  follow-up (the verdict schema already carries model_used).
- Keyword (keyless) search matches substrings, not paraphrases; semantic
  retrieval needs an embedding provider.

Use Mem0 or Zep for cross-session chat personalization. Use Marrow when the
thing that must not be forgotten, duplicated, or silently rewritten is what
your team decided.
