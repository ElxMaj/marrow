---
"@marrowhq/core": minor
"@marrowhq/cli": patch
---

marrow lint finds semantic near-duplicates.

Paraphrase duplicates were invisible to the exact-title sweep, so the pairs
the write-time guard inevitably misses had no scheduled audit. Lint now runs
a bounded pgvector distance pass over open, decided, and contested decisions
and goals (capped nodes, five neighbors each, each unordered pair reported
once) and reports near_duplicate_nodes issues with the distance in the
detail. Exact-title groups keep their own issue kind, conflicting pairs stay
with the contradiction check, and the sweep is read-only as ever.
