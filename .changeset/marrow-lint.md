---
"@marrowhq/core": minor
"@marrowhq/cli": minor
---

Add marrow lint: a read-only graph-hygiene sweep.

`marrow lint` reports duplicate nodes (the same normalized title within a kind), contradictions (two decisions that conflict on a shared term), and dead edges (a link whose endpoint no longer exists), so a human can clean the graph as it grows. It only reports: it never resolves, deletes, or raises anything, so it is safe to run on a schedule. The duplicate-grouping logic lives in a pure `lint.ts` (`findDuplicateTitles`), testable in isolation.
