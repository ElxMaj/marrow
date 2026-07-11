---
"@marrowhq/core": minor
---

Temporal accuracy eval: current state wins, history stays reachable.

After a human resolves a conflict, every retrieval surface must serve the
winner and never the superseded loser (current-state accuracy), while the
loser remains fully reachable with its content and provenance intact
(historical accuracy: invalidation, not erasure). runTemporalEval measures
both at 1.0 on a bundled golden set, driving every promotion and supersede
through core.answer, the one sanctioned human path. It runs in semantic mode
on paraphrase topics and keyless on keyword topics, and refuses an empty
case list.
