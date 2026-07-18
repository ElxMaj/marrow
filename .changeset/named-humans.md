---
"@marrowhq/shared": patch
"@marrowhq/core": patch
"@marrowhq/cli": patch
"@marrowhq/web": patch
---

Named humans: every promote-to-decided records who decided. An additive nullable decided_by column (migration 0018) is written at the moment of promotion from an identity resolved as an explicit --as flag, then MARROW_USER, then the OS login name. It surfaces in CLI reads ("1.00 human (priya)"), the web SourcePanel ("priya stands behind this"), and MCP trace via the confidence object. It is metadata about the promote event: no agent path can set it (proven in tests), and it stays out of the token-scoped prepare_task brief and the benchmark measurement so the token economy and the CI-gated numbers are unchanged.
