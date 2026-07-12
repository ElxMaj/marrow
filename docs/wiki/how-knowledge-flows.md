# How knowledge flows

This page follows one fact through Marrow, from the moment someone says it to the moment it is replaced or corrected. The short version: words are recorded verbatim and never edited, distillation turns them into proposed facts that each cite an exact quote, humans settle the open questions, and later facts replace earlier ones through a lineage you can walk. Nothing in this pipeline decides truth on its own.

## Step 1: the words are recorded

Everything starts as evidence, a verbatim record of what was said or written. You can add evidence from a file, a folder, or stdin:

```bash
marrow ingest ./meetings/2026-07-06-pricing.vtt
marrow add notes.md --source "pricing sync"
```

Evidence is append-only. Once a row is written it is never mutated, which is why secret scrubbing happens before storage, not after: every writer passes through one insertion point that replaces credential-shaped text with visible markers like `[redacted:aws-access-key]` before it touches the database. Scrubbing is on by default and removes secrets on the way in only; nothing in Marrow deletes evidence after it is stored. The full detector list and the opt-out live in [Trust and safety](./trust-and-safety.md).

## Step 2: distillation proposes facts

Distillation reads a piece of evidence and extracts four kinds of nodes: entities (things your product talks about), decisions (choices, with a rationale), goals (what you are trying to achieve), and questions (ambiguities for a human). It runs automatically after ingest when a model is configured, or on demand:

```bash
marrow distill ev_abc123
marrow distill --pending
```

Two rules make distillation trustworthy. First, every extracted item must carry a verbatim quote, and that quote must be located as an exact character span in the source evidence. If the span cannot be resolved, the item is dropped. Nothing is ever stored without provenance. Second, the extraction policy filters transient chatter deterministically, before anything is inserted. The default policy drops scheduling talk and greetings; you can extend it in `.marrow/policy.json` with your own deny patterns and sources that should never be auto-distilled.

Everything distillation produces has status `open` with model-sourced confidence. Distillation never produces a decided fact.

## Step 3: duplicates merge, look-alikes get a question

After extraction, Marrow links the new nodes into the graph and checks them against what already exists.

If a new decision or goal restates an existing open one word for word (same normalized title), the two merge, and the existing fact survives. The incumbent keeps its identity and gains the new quote as extra provenance; the newcomer is deleted. Saying the same thing in three meetings gives you one fact with three sources, not three facts.

If the new node is only a near duplicate (a paraphrase, caught by embedding distance), Marrow does not guess. It records an advisory `duplicates` edge and raises a question asking whether the two are the same. A human answers; the system never merges on similarity alone.

## Step 4: a human decides

Open questions are where the pipeline hands off to you:

```bash
marrow questions
marrow answer q_xyz789 --text "Yes, we ship the soft-delete flow first."
```

Answering is the only path that promotes an open fact to `decided`. (The one other way a decided node comes to exist is a human authoring a goal directly with `marrow goal author`; that path is just as human-only.) Your answer text is itself stored as immutable evidence, the promoted fact gets human-sourced confidence of 1, and the verification date is stamped at that moment. That `verifiedAt` stamp is what freshness checks later use to flag decided facts that may have gone stale.

## Step 5: conflicts create lineage, not overwrites

When a new decision contradicts one that is already decided, Marrow marks the newcomer `contested` and raises a question: which one holds? When you answer a question that relates to both sides, you name the winner explicitly:

```bash
marrow answer q_conflict1 --text "The new pricing supersedes the old." --decide dec_new456
```

The loser is not deleted. It becomes `superseded`, and a human-sourced `supersedes` edge links winner to loser, citing your answer as evidence. That chain is walkable:

```bash
marrow history dec_new456
```

This shows the full lineage, oldest first: what the team believed, when it changed, and why.

## Step 6: corrections are human-only

Sometimes a fact is simply wrong, not superseded by a better one. For that there is retract:

```bash
marrow retract dec_bad123 --reason "This was a misreading of the transcript."
```

Retract is deliberately a human act. It requires a reason, and there is no MCP tool for it, so an agent cannot retract anything. Retracting a decided fact additionally requires `--force`, because settled truth is normally replaced through the answer loop rather than pulled. The retracted node is not erased: the reason is stored as evidence, the node stays inspectable by id, and it is excluded from search results and graph walks from then on.

## Checking the trail

At any point you can ask a fact to show its receipts:

```bash
marrow trace dec_new456
```

This prints the exact quoted span from the source evidence. Because every distilled node carries at least one span, the trail from any fact back to the words that produced it is never broken.

## Keep reading

- [Core concepts](./core-concepts.md): the node kinds, statuses, and edges this page walks through.
- [Trust and safety](./trust-and-safety.md): scrubbing, injection smells, and the skeptic in depth.
- [CLI reference](./cli-reference.md): every command shown here, with all flags.
