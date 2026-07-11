---
"@marrowhq/core": patch
---

Entity merges no longer erode the knowledge graph.

The dedupe path deleted a duplicate entity but stranded every edge and
verification row pointing at it, so each merge quietly removed connectivity
that walked retrieval depends on, and lint counted the debris as dead edges
after the fact. deleteEntity now re-points the duplicate's edges (deduped
against the unique index, self-loops dropped) and verifications to the
canonical node inside the same transaction, and removes them when there is no
canonical, so nothing dangles. The re-pointing helper is kind-agnostic so
future merge paths complete their deletes the same way.
