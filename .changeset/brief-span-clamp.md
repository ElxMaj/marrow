---
"@marrowhq/core": patch
---

Task briefs clamp giant quoted spans; trace_to_source stays byte-exact.

A node citing a whole document injected the whole document into every brief
that included it: the maximal injection surface and the worst context-noise
hit. Brief spans now clamp at 600 characters with an explicit truncated
marker pointing at trace_to_source, which remains the lossless, byte-exact
path for audits and the web console.
