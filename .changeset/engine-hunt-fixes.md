---
"@marrowhq/core": patch
"@marrowhq/cli": patch
"@marrowhq/web": patch
---

Fix eight adversarially-confirmed defects from an engine bug hunt.

- Secret scrub (sacred rule 1): Stripe-style underscore keys (`sk_live_`,
  `sk_test_`, `rk_live_`) were missed by the `sk-` rule and reached immutable
  evidence in plaintext. Added a sibling detector.
- Connector sync: an idle run fell back to the local wall clock instead of
  keeping the prior high-water mark, silently dropping items that became visible
  after the run. It now retains the cursor.
- VTT transcripts: a cue whose spoken text began with NOTE/STYLE/WEBVTT was
  dropped as a comment block. Comment skipping now applies only between cues.
- Entity merge: deleting an entity a goal referenced tripped the goal.entity_id
  foreign key and rolled back the whole distill; the merge now re-points (or
  detaches) the goal like it already does for edges and verifications.
- Drift matching: `codeMatchesTerm` and `decisionsConcerningEntity` matched
  terms as substrings, so "sync" hit "async", "test" hit "latest", "auth" hit
  "author" (false drift questions and bogus concerns edges). Both now match
  whole identifier words, splitting camelCase and snake_case.
- CLI: `--hops` and `--depth` were missing from the value-flag set, so placing
  them before the node id made the parser read the flag's number as the id.
- Web API: a non-positive or fractional `limit` query param reached SQL as a
  negative LIMIT and 500d; it now falls back to the default.
