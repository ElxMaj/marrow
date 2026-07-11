---
"@marrowhq/shared": minor
"@marrowhq/core": minor
"@marrowhq/mcp-server": minor
"@marrowhq/cli": minor
"@marrowhq/web": minor
---

Make the next release jump past the stale npm 0.4.1 build.

npm's 0.4.1 was published from the pre-reset repo history: it lacks `marrow doctor`, the error-remedy mapping, and ships compiled test files. The repo sits at 0.4.0, so a patch release would collide with it. This minor bump releases the whole fixed group as 0.5.0, carrying everything queued on main (the knowledge graph, freshness, the skeptic, lint and synthesize, and the first-run hardening). Launch preflight now also fails if a packed tarball would ship built test files, so the 0.4.1 mistake cannot repeat.
