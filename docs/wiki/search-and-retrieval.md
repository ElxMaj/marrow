# Search and retrieval

Marrow gives you two ways to find things, and they are deliberately different. When you have a quick question, you run a flat search: one query, a short ranked list, done. When an agent is about to start work, it calls `prepare_task`, which does more: it searches, walks the knowledge graph around the best hits, and assembles a small task brief with decided facts, open questions, and provenance. Neither path ever returns the whole brain. Everything is scoped to what you asked.

## Flat search for a quick question

The command is `ask`:

```bash
marrow ask "what did we decide about soft deletes"
```

This runs Marrow's search over entities, decisions, goals, and questions. Retracted facts are excluded entirely. Superseded and dismissed facts sort behind live ones, so the current state of the world comes first and history stays reachable below it.

Flat search stays flat on purpose. A quick question deserves a cheap, predictable answer: a short list you can scan, with stable ordering and no surprises. The graph walk lives in `prepare_task` instead, because that is where the extra tokens earn their keep.

## prepare_task for starting work

When an agent is about to touch the code, a ranked list is not enough. It needs the decided constraints, the open questions it should not steamroll, and the receipts. That is the task brief. Agents get it through the `prepare_task` MCP tool; you get the same brief from the CLI:

```bash
marrow loop "add CSV export to the billing page"
```

The brief separates what is safe to build (decided goals and decisions, goals first) from what needs a human first (contested facts and open questions). If anything is contested or open, the brief says `ask_human_first` rather than pretending the coast is clear.

### The graph walk inside prepare_task

Here is the part flat search does not do. `prepare_task` takes its top search hits as seeds and walks the knowledge graph two hops out from them, following edges like `concerns`, `serves`, and `supersedes`. Nodes found on the walk get a relevance boost: seeds score highest, first-hop neighbors next, second-hop neighbors least.

Why this matters: it folds in connected decided facts that share no words with your task. If your task says "billing page" and a decided constraint says "soft delete only, never hard delete rows", keyword overlap is zero. But if both connect to the same entity in the graph, the walk finds the constraint and puts it in the brief anyway.

The walk is bounded. Two hops, a hard cap on how many neighbors it will consider, and a fixed limit per brief section. It enriches the slice around your task; it does not crawl the graph.

## Keyword mode versus embedding mode

Marrow works with no API key at all. In that mode, search is keyword matching: your query terms are matched as substrings against titles, names, rationales, prompts, and descriptions. This is honest but literal. "Soft delete" finds "soft delete". It does not find "we never hard-remove rows", because substrings are not paraphrases.

With embeddings, search becomes semantic-first: results are ranked by meaning (cosine similarity), and keyword matching fills in or acts as a fallback. You do not need to run an embedding service. If you set no embedding endpoint, Marrow uses a zero-config in-process embedding provider. To point at a remote one instead, set these in your environment or `.env`:

```bash
MARROW_EMBEDDING_MODEL=text-embedding-3-small
MARROW_EMBEDDING_BASE_URL=...   # optional; omit to embed in-process
MARROW_EMBEDDING_API_KEY=...    # optional
```

If you want a brief or drift scan without the semantic layer, both commands take a flag:

```bash
marrow loop "your task" --no-semantic
marrow drift --no-semantic
```

## The token economy

Retrieval exists to make agent context smaller, so we measure it in tokens. On the bundled labeled corpus (twelve documents, 1209 tokens when dumped raw), the committed benchmark reports:

- Flat search: a 2.9x token reduction versus dumping the raw corpus, at retrieval recall of 1 on the labeled questions, with a context-noise ratio of 0.48.
- The `prepare_task` brief: a 1.5x reduction. The ratio is smaller because the brief carries more than search hits: decided truth, open questions, and provenance spans ride along.

The two ratios are always reported separately, never blended, because they answer different questions: "what does a lookup cost" versus "what does starting work cost". You can reproduce both numbers yourself:

```bash
marrow eval --all
```

That runs in a disposable scratch schema on your Postgres and never touches your real brain. For what each metric means and how the gates work, see [How we measure memory](./measuring-memory.md).

## Nothing ever returns the whole brain

Every retrieval surface in Marrow is capped and scoped:

- `marrow ask` returns a bounded ranked list, not a dump.
- The task brief caps each section at a handful of items.
- Long quoted spans in a brief are truncated, with a pointer to fetch the exact source. The trace itself returns the full verbatim span:

```bash
marrow trace <nodeId>
```

- Even the map view is a bounded index, most-connected nodes first:

```bash
marrow map --limit 50
```

If you feel like you are missing context, the answer is a better query or a walk from a specific node (`marrow neighbors <nodeId> --hops 2`), not a bigger dump. That constraint is what keeps agent prompts small and keeps retrieval honest.

## Keep reading

- [Core concepts](./core-concepts.md): the node kinds, statuses, and edges the graph walk traverses.
- [How we measure memory](./measuring-memory.md): methodology behind the recall, noise, and token numbers above.
- [Working with agents](./working-with-agents.md): how `prepare_task` fits into an agent's loop.
