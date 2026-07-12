---
"@marrowhq/mcp-server": minor
---

append_evidence distills inline: what an agent writes is retrievable in the
same session.

The MCP write path always deferred distillation, so an agent's own
mid-session write was invisible to its very next search: the
user-tells-agent, agent-forgets loop. append_evidence now distills inline by
default when a model is configured (distill: false defers and names the
drain command). Distillation only proposes OPEN nodes, so the tool still
cannot decide anything, and the write-time near-duplicate guard applies to
what it creates.
