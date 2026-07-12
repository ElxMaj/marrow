---
"@marrowhq/shared": minor
"@marrowhq/core": minor
---

Write-time near-duplicate guard for decisions and goals.

The same decision restated in new evidence became a second open node
forever, and MCP propose_node (the noisiest writer) had zero dedup. Now an
exact normalized-title match where both nodes are open merges provenance
into the PRE-EXISTING node (the survivor is always the node that was there
first; the just-created duplicate is deleted through the re-pointing helper
so no edge or verification strands). Any pair involving settled or contested
truth, and every paraphrase-level embedding match, gets an advisory
duplicates edge (new relation, migration 0017) plus one deduped "is X the
same as Y?" question instead: a human resolves it, nothing merges silently,
no status ever changes. Conflicting pairs are skipped (a contradiction is
not a restatement; the conflict path asks the sharper question), and
degenerate embeddings produce no paraphrase signal. The write eval's
re-ingestion duplicate rate drops from 0.22 to 0 in the committed scorecard.
