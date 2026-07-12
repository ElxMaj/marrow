---
"@marrowhq/shared": minor
"@marrowhq/core": minor
"@marrowhq/cli": minor
---

marrow retract: the human-only correction for false memories.

A standalone false fact could not be corrected: answer() only promotes or
supersedes inside two-sided conflicts, and dismiss is drift-catch-only, so a
hallucinated proposal stayed retrievable forever. marrow retract <id>
--reason "..." marks it retracted: the node keeps its content, provenance,
and the reason (stored as append-only evidence and linked as provenance),
but stops surfacing in keyword search, semantic search, and neighbor walks.
It stays fully inspectable by id and in traces: invalidation of retrieval,
never erasure. A decided fact is refused without --force, since settled
truth is normally replaced through the answer loop. There is deliberately NO
MCP tool: agents cannot retract, which is the promote gate's mirror.
Migration 0016 adds the status to the four node tables.
