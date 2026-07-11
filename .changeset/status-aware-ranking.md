---
"@marrowhq/core": patch
---

Current facts outrank retired facts in search.

Superseding a fact bumps its updated_at, and keyword search sorted by
updated_at desc, so the fact a human just retired ranked FIRST for its own
keywords; semantic search tied old and new. Search results now re-rank by
status (decided first, open and contested next, superseded and dismissed
last), stable within each group so semantic distance still decides among live
facts. Retired facts stay retrievable, just behind the current truth:
invalidation, not erasure. Same k results in and out, so the measured token
benchmark is unchanged by construction, with a test proving it.
