---
"@marrowhq/core": patch
"@marrowhq/cli": patch
---

No fact without a real quote, enforced: the store rejects any provenance span that falls outside its evidence text at the one choke point every insert path funnels through (including MCP propose_node), so a fact whose quote would render blank or truncated can no longer be created. marrow lint gains an out_of_bounds_span check that surfaces legacy rows.
