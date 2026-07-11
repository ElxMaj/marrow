---
"@marrowhq/core": minor
"@marrowhq/mcp-server": minor
"@marrowhq/cli": minor
---

Add a front-door index: see what exists before searching.

- Core `getIndex(limit)` (store `listIndex`) returns a bounded list of every node as id, kind, one-line title, status, and degree (how connected it is), the hubs first. Titles only, never bodies or provenance, so it shows what exists without being the whole brain.
- MCP tool `get_index` and CLI `marrow map [--limit N]` expose it, so an agent or a developer gets an overview of the brain and its most connected nodes at a glance.
