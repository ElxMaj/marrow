---
"@marrowhq/core": minor
"@marrowhq/cli": patch
"@marrowhq/mcp-server": patch
---

Scrub secrets before the append, because there is no after.

Evidence is immutable by design, so an API key that reached the insert was
frozen in the brain forever. Every evidence insert now runs a conservative
credential detector (AWS keys, GitHub and Slack tokens, sk- provider keys,
JWTs, PEM private-key blocks, and password/token/api_key assignments with a
digit in the value) and replaces each match with a visible [redacted:kind]
placeholder. The scrub lives in the store's insertEvidence, the single choke
point every writer goes through: ingest, connector sync, and answer
resolutions included. CLI receipts and the MCP append_evidence result report
how many secrets were caught. MARROW_SCRUB=off opts out.
