---
"@marrowhq/core": minor
"@marrowhq/mcp-server": minor
"@marrowhq/cli": minor
---

Add a neighbor surface: read a node's place in the knowledge graph.

- Core `getNeighbors(nodeId, maxHops)` returns a node and the nodes linked to it, each with the relation, hop distance, status and title. Bounded (never the whole brain) and read only.
- MCP tool `get_neighbors` and CLI `marrow neighbors <id> [--hops 1|2]` expose it, so an agent or a developer can walk from a fact to the decisions about it, the goal it serves, or the facts it conflicts with or supersedes.
