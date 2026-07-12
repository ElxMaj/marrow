---
"@marrowhq/core": minor
"@marrowhq/cli": minor
---

marrow redact, part two: cascade and the completeness check.

--cascade extends the redaction over the nodes that quote the leaked row:
each is retracted, its text columns tombstoned, and its embedding rows
deleted, while the row ids, citations, and history survive. A decided
citing node refuses without --force (settled truth needs the same explicit
override as a direct retract), the refusal destroys nothing, and the
append-only audit row names every decided node the human forced over,
never the secret. marrow redact --check verifies a redaction end to end
(tombstone, retractions, tombstoned text, zero embeddings), and marrow
doctor sweeps every recorded redaction with a bounded completeness check.
Still CLI-only: no MCP path exists.
