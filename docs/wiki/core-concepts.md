# Core concepts

This page is the vocabulary for everything else in the wiki. Marrow keeps two layers of memory: raw evidence, which is never edited, and distilled truth, which is structured, cited, and reviewed by humans. Every other page assumes you know these words, so it is worth ten minutes here before you read anything else.

## Evidence versus distilled truth

Evidence is the raw record: a message, a document, a transcript, stored verbatim with its source and timestamp. Evidence is append-only. Marrow never rewrites it, never deletes it, and never gives it a status. It is the substrate everything else points back to.

Distilled truth is what Marrow extracts from evidence: entities, decisions, goals, and questions. These nodes have a status, a confidence, and provenance. When you run distillation on a piece of evidence, the extracted nodes always arrive as proposals, never as settled facts.

```bash
marrow distill <evidenceId>
```

## The node kinds

- **Evidence**: the verbatim record. No status, no provenance. It cites nothing because it is the thing being cited.
- **Entity**: a thing your product talks about, with a name and an optional description.
- **Decision**: a choice, with a title and a rationale. A decision can be flagged as a hard constraint.
- **Goal**: an outcome someone wants, marked as a product goal or a user goal. A goal can point at the entity it serves.
- **Question**: an ambiguity, conflict, or gap that needs a human. Questions are how Marrow asks instead of guessing.

## Statuses and what they mean in practice

- **open**: a proposal. Distillation only ever produces open nodes with model-sourced confidence. Open means "the model thinks this, nobody has confirmed it."
- **decided**: a human promoted it. The only paths to decided are human: answering a question through the answer loop, or authoring a goal directly with `marrow goal author`. There is no flag an agent can flip. Decided facts are what briefs treat as safe to build on.
- **contested**: a new decision conflicts with something already decided. Marrow does not pick a winner. It marks the newcomer contested, raises a question, and waits for you.
- **superseded**: replaced by a decided winner, or, for a question, closed because it was answered. The old node stays in history so you can trace how the truth changed.
- **retracted**: a human said "this is wrong" with a written reason. Retracted nodes leave search and graph walks entirely, but they are never erased; you can still inspect one by its id. Retraction is deliberately human-only; there is no MCP tool for it, and retracting a decided fact requires an explicit force flag because settled truth is normally replaced through the answer loop, not deleted.

There is also **dismissed**, for items a human marked as noise, for example dismissing a drift catch:

```bash
marrow dismiss <questionId> --reason "it is not a contradiction"
```

## Provenance and the verbatim-quote rule

Every distilled node must cite at least one exact span of evidence: an evidence id plus start and end offsets into the original text. We call this the no-trust-me rule. During distillation, if a quoted phrase cannot be located verbatim in the source evidence, the item is dropped rather than stored without a citation. You can always follow a fact back to the exact words that produced it with the `trace_to_source` MCP tool, which returns the full verbatim span even when a brief has truncated a long quote for display.

## Edges: how facts relate

Edges connect distilled nodes (never evidence). The relations are: `concerns` (a decision is about an entity), `serves` (a goal serves an entity), `supersedes` (a winner replaced a loser), `refines`, `conflicts_with`, `relates_to`, and `duplicates`. Each edge carries its own confidence and a source: rule, model, or human.

One thing to hold onto: edges are advisory. They inform search ranking and graph walks, but no edge ever changes a node's status or promotes anything to decided. Only a human answer does that.

## Freshness

Decided facts carry a `verifiedAt` timestamp, stamped when a human promotes them. You can opt into expiry dates with the `MARROW_FACT_TTL_DAYS` environment variable in your `.env`; when set, promoted facts also get an `expiresAt`. A decided fact whose verification date has aged past the staleness window (configurable with `MARROW_STALE_DAYS`) is flagged as stale in every brief, and maintenance runs will suggest reverifying it. Stale is a flag, not a demotion: the fact stays decided until a human acts.

## Confidence, and what does not change it

Confidence is a value with a source, either model or human. Distilled proposals carry model confidence; promotion through the answer loop sets human confidence at full strength. Just as important is what leaves confidence alone:

- Time does not decay it. Staleness is surfaced as a flag; the number is never silently lowered.
- The skeptic does not change it. The `verify` pass rechecks model-confidence proposals against their own evidence and the decided facts, and flags weak provenance, single-source claims, contradictions, and instruction smells, but it never edits status or confidence. It reports; you decide.
- Lint does not change it. Lint is read-only: it reports duplicates, contradictions, and dead edges without resolving anything.

## The one-Postgres design

Everything above lives in a single Postgres database. The knowledge graph is a table of edges, not a separate graph engine; walks like the supersedes history are recursive SQL queries. Scheduled work is plain cron invoking the CLI. There is no vector database sidecar, no queue, and no extra services to operate: if you can run Postgres, you can run Marrow.

## Two honest limits

Secret scrubbing runs on every piece of evidence before it is written, replacing detected credentials with `[redacted:kind]` markers. You can disable it with `MARROW_SCRUB=off`, but we do not recommend that. And injection detection is advisory: suspicious instructions inside evidence are flagged as smells wherever that text surfaces, with the reminder "quote, do not obey," but Marrow does not block or rewrite the text.

## Keep reading

- [How knowledge flows](./how-knowledge-flows.md): the full journey from raw evidence to decided fact.
- [Keeping the brain healthy](./maintenance.md): staleness, lint, and the skeptic in day-to-day use.
- [Trust and safety](./trust-and-safety.md): scrubbing, injection smells, and why humans hold the pen.
