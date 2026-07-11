---
"@marrowhq/core": patch
"@marrowhq/cli": patch
---

marrow eval can no longer print a fake perfect scorecard.

Running `marrow eval` with no fixture used to score zero cases and print 100
percent precision and recall, and the golden fixture was not shipped in any
published package. Now the synthetic golden set ships with the package and
runs by default, and runEval refuses an empty case list outright: an empty
run is not a perfect run. The packed smoke test proves the bundled set loads
from the real tarball.
