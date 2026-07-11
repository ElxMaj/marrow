---
"@marrowhq/core": minor
---

Extract knowledge graph edges during distillation and answering.

Distillation now records the links it already computes as walkable edges, reusing the exact heuristics that raise questions today, so no new model call is needed:

- `entity -concerns-> decision` for every decision about an entity.
- `goal -serves-> entity` for the entity a goal is attached to.
- `decision -conflicts_with-> decision` and `goal -conflicts_with-> goal` alongside the conflict question they already raise.
- `decision -supersedes-> decision` (and goals) written by a human `answer`, the one human-sourced edge.

Every edge is idempotent on re-distill and never changes a node status: the question and the human answer remain the only things that settle a fact.
