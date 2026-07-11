---
"@marrowhq/core": minor
"@marrowhq/cli": minor
---

See and drain the distill backlog, and drop the dead queue.

Evidence appended without distillation (the session-end hook, `marrow add
--no-distill`, connector sync) used to be invisible forever: nothing scheduled
ever distilled it, and no surface admitted it existed. Now:

- `marrow truth` shows the undistilled backlog (count, oldest row, a sample)
  with a drain action, and `marrow synthesize` counts it in the weekly digest.
- `marrow distill --pending [--limit N]` drains the backlog newest-first,
  reporting per-row node counts and the remainder. An empty backlog needs no
  model key, so the scheduled template stays green; a real backlog with no
  model fails loud. The maintenance workflow runs it before synthesize.
- The pg-boss queue and worker are gone. Nothing in production ever
  constructed them, and the drain covers evidence that was never enqueued.
  One Postgres, no queue service: the code now matches the rule. The unused
  enqueuer slot is dropped from the Marrow constructor.
