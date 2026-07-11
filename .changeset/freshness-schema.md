---
"@marrowhq/core": minor
---

Give distilled facts a time dimension: verified_at and expires_at.

Every distilled node now carries two optional timestamps. `verified_at` is stamped only when a human promotes a fact (the answer is the verification event), so a decided fact records that a human stood behind it, and when. `expires_at` is opt-in: set `MARROW_FACT_TTL_DAYS` and a promoted fact gets an expiry; otherwise it does not expire. Confidence is never decayed in place, so a human-set 1.00 stays honest; freshness is recorded so it can be surfaced, not enforced. Migration 0014 is additive and nullable, so every existing fact reads back with null freshness.
