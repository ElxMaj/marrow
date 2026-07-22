---
"@marrowhq/shared": minor
"@marrowhq/core": minor
"@marrowhq/cli": minor
"@marrowhq/mcp-server": patch
---

marrow redact, part one: the audited tombstone for leaked secrets.

Evidence is append-only by design, so a credential that slipped past the
pre-append scrub was immortal. Redaction is the single, visible exception:
marrow redact <evidenceId> --reason destroys ONE row's payload bytes behind
a fixed tombstone while the row itself (id, source, date, citations)
survives, the moment and reason are stamped, and a normal append-only audit
evidence row records that it happened, never the secret. It refuses when
distilled nodes still cite the row (the human must see the blast radius;
cascade arrives in part two), refuses a second redaction, and is CLI-only:
there is deliberately no MCP path, pinned by a test, so no agent and no
instruction embedded in retrieved memory can trigger destruction.
