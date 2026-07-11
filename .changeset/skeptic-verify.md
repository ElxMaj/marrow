---
"@marrowhq/core": minor
"@marrowhq/cli": minor
"@marrowhq/mcp-server": minor
---

Add the skeptic: a fresh-context verify gate over proposed facts.

`marrow verify` (and the MCP `verify` tool) attacks every open, model-proposed fact with a fresh context: it sees only the node's own evidence and the decided facts it might contradict, never the conversation that proposed it. It flags a proposal that is single-source, weakly-sourced (a tiny span or low confidence), or contradicts a decided fact, records an append-only verdict (migration 0015), and raises a normal question on a contradiction. It never promotes a fact: this reinforces the propose/promote gate rather than bypassing it, and no verdict ever changes a node's status. The reason logic lives in a pure `skeptic.ts` so it is testable in isolation.
