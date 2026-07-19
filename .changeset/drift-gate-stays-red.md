---
"@marrowhq/core": patch
"@marrowhq/cli": patch
---

The drift gate stays red while the violation lives: a scan now reports still-open catches that match the current diff (openMatches), so re-running drift --ci cannot launder an unresolved contradiction green; the gate clears only when a human accepts or dismisses the catch. Plain drift output lists pending open catches with the paste-ready resolution commands instead of reading all-clear. GitHub annotations now carry the bare file path (the prose prefix no longer leaks into file=).
