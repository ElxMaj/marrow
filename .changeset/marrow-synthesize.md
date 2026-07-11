---
"@marrowhq/core": minor
"@marrowhq/cli": minor
---

Add marrow synthesize: a read-only "what changed and what deserves attention" digest.

`marrow synthesize [--days N]` (default 7) summarizes a window of the brain: which facts changed, what was newly decided, what is contested, which decided facts are stale, how many drift catches surfaced, and how many questions are open, with a one-line plain-language headline. It is the weekly maintenance pass the "keep the brain alive with loops" idea calls for, and it writes nothing. The headline formatter is a pure `synthesize.ts` helper, testable in isolation.
