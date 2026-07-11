---
"@marrowhq/core": minor
"@marrowhq/mcp-server": minor
---

No agent path to a status write: MCP accept_catch and dismiss_catch record,
never close.

The MCP accept_catch tool promoted a drift question to decided (stamped
human-confident) from a pure agent tool call, and dismiss_catch could silence
an alarm the same way. That was both a hole in the promote gate and the
sharpest injection target: an instruction embedded in retrieved evidence
could tell the agent to accept its own drift catch.

Both tools now call recordCatchResolution: the reaction is stored as
append-only evidence plus a catch event with trigger 'agent', the pending
list clears (someone reacted), but the question stays open. Closing it stays
a human act through the CLI (marrow accept / marrow dismiss), and the
human-labeled catch metrics exclude agent-triggered events, so agents cannot
inflate their own precision. After this change no MCP tool writes any status
beyond proposing open nodes.
