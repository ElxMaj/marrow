---
"@marrowhq/core": patch
"@marrowhq/web": patch
---

Close the two bugs deferred from the engine hunt.

- Distill embedding reconcile: a node insert and its embedding write are separate
  transactions, so a transient embedding failure could leave a committed node
  with no vector, and the idempotent re-distill skip made that permanent, hiding
  a real fact from semantic search. Distill now re-embeds any existing node
  missing its vector at the start of the pass (a no-op once everything is
  embedded), via a new `store.hasEmbedding`.
- API timestamp validation: the `since` / `until` / `before` query params are
  validated as ISO-8601 at the boundary and rejected with a fixed 400, so a
  malformed value never reaches Postgres as an uncastable timestamp whose raw
  error the error classifier would otherwise reflect to the client.
