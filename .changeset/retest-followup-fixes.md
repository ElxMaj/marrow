---
"@marrowhq/web": patch
"@marrowhq/core": patch
"@marrowhq/cli": patch
---

Close the two low, non-gated gaps the 2027 retest logged.

Serverless API hygiene: the Vercel handlers now share one error classifier and a
`route` wrapper, so a client fault answers a typed 4xx (413 oversized body, 400
malformed JSON, 404 for an unknown id, 405 for a wrong verb) instead of the raw
500 Vercel would otherwise return. The `trace` GET in particular now answers 404
for an unknown node id. This mirrors the Node server, kept in step with it.

Skeptic visibility: `traceToSource` now carries the skeptic's latest verdict
(`verification`), and `marrow trace` prints it. This gives `latestVerification`
its one real caller and makes a flag visible where a fact is inspected. It is
advisory only: it never reorders retrieval and never changes a status, which
reconciles the earlier "survivors are ranked up" overreach.
