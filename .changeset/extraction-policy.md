---
"@marrowhq/core": minor
"@marrowhq/cli": patch
---

The extraction policy: a deterministic denylist behind the prompt.

The only thing keeping transient details out of the brain was a fixed
prompt. A .marrow/policy.json (denyPatterns, noDistillSources, neverDistill
categories) now merges over conservative defaults and is enforced twice: a
prompt clause asks the model to skip the named categories, and a
deterministic post-extraction filter drops matching items BEFORE anything is
inserted, with the drop count recorded in the distill run's metadata so
audits see filtered volume. Sources matching a no-distill glob store their
evidence but never auto-distill. A malformed pattern or unreadable policy
file is skipped silently: policy must never take ingestion down.
