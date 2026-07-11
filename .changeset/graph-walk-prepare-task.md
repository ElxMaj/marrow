---
"@marrowhq/core": minor
---

Walk the knowledge graph in prepare_task so retrieval gets stronger as the brain grows.

`prepare_task` now seeds from the usual search hits, then walks the graph one to two hops along the edges written during distillation, and folds those neighbors into its relevance scoring (a search hit is boosted most, a 1-hop neighbor next, a 2-hop neighbor least). A decided fact one or two hops from the task, even one that shares no words with it, can now enter the brief, which is the concrete way the brain gets stronger as it grows instead of noisier.

The walk is one bounded query and stays inside `prepare_task`: `search()` is left flat, so the measured token benchmark is unaffected and the brief is still capped and task-scoped, never the whole brain. The walk is pure Postgres, so it helps most when no embedding model is set.
