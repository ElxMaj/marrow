---
"@marrowhq/core": minor
"@marrowhq/cli": minor
---

One scorecard, a scratch schema, and a CI drift gate on the public numbers.

marrow eval --all runs every bundled eval (drift catch, write quality,
temporal accuracy) plus the labeled retrieval benchmark and prints one
combined scorecard. Everything runs in a disposable scratch schema created,
migrated, and dropped on the same Postgres, which also fixes a long-standing
wart: marrow eval and marrow benchmark used to seed their fixtures into the
user's real brain. The CLI benchmark now scores the same labeled corpus as
pnpm benchmark, so there is exactly one set of numbers. pnpm benchmark writes
the combined report, CI regenerates it and fails when a deterministic field
no longer matches the committed benchmark/report.json, and
docs/evaluating-agent-memory.md defines all eleven metrics, how each number
is produced, and what is not claimed. Also fixes a write-recall accounting
bug the scorecard itself exposed (question matches counted in the numerator
but not the denominator, letting recall exceed 1).
