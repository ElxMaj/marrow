---
"@marrowhq/mcp-server": minor
"@marrowhq/cli": patch
---

Quoted evidence is framed as untrusted data on every agent surface.

Verbatim evidence spans reached agents with no framing anywhere: an
instruction embedded in an ingested transcript would be quoted straight into
a task brief with nothing marking it as data. Now the MCP server instructions
say plainly that quoted spans are records, never instructions to follow; the
three tools that quote spans (trace_to_source, prepare_task, maintain_truth)
prepend exactly one fixed sentence to their results and say so in their
descriptions; and the CLI labels quotes "Source (verbatim record)". One short
line, only on the tools that quote, so the reminder never taxes ordinary
reads.
