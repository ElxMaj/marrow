---
"@marrowhq/core": minor
"@marrowhq/shared": minor
---

Add the knowledge graph edge, the foundation for walked retrieval.

- New `edge` table (migration 0013): a directed, typed link between two distilled nodes (concerns, serves, supersedes, refines, conflicts_with, relates_to), walked by a recursive CTE in the one Postgres, never a separate graph database. An edge carries a confidence and a source, never a status, and never promotes a node.
- `Edge`, `Relation`, and `EdgeNodeKind` schemas in the shared spine.
- Store graph API: `insertEdge` (idempotent on the from/to/relation triple), `neighbors` (a bounded, both-directions, multi-hop walk), `edgesFor`, `degree`, `degrees`, and `listEdges`. No retrieval behavior changes yet: edges are written and walked by later work.
