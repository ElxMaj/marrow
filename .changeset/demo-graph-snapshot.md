---
"@marrowhq/web": patch
---

The hosted demo's living map has data: the static export now bakes the node-link graph into state.json (the ported export script predated the map and omitted it, so the demo's Graph view claimed the brain was empty while nodes existed). The export test asserts the graph rides in every snapshot.
