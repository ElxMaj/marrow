---
"@marrowhq/core": minor
"@marrowhq/web": minor
---

Turn the console Graph view into a living map of the knowledge graph.

The Graph section was a filterable card grid. It is now a dependency-free, hand-rolled SVG node-link map: every distilled fact is a dot, sized by how connected it is and coloured by status; every edge is a line. A deterministic force layout (see `layoutGraph`) settles clusters so the brain reads as a connected web that gets denser, and more useful, as the room grows. Drag to pan, use the zoom controls, and click any node to trace it to the exact source span. A Map/List toggle keeps the old card view. Core gains `getGraph()`, and `/api/state` now carries the bounded node-and-edge graph (titles only, never bodies or provenance), so the static demo export includes it automatically.
