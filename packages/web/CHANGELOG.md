# @marrowhq/web

## 0.5.0

### Minor Changes

- 6e5f698: Turn the console Graph view into a living map of the knowledge graph.

  The Graph section was a filterable card grid. It is now a dependency-free, hand-rolled SVG node-link map: every distilled fact is a dot, sized by how connected it is and coloured by status; every edge is a line. A deterministic force layout (see `layoutGraph`) settles clusters so the brain reads as a connected web that gets denser, and more useful, as the room grows. Drag to pan, use the zoom controls, and click any node to trace it to the exact source span. A Map/List toggle keeps the old card view. Core gains `getGraph()`, and `/api/state` now carries the bounded node-and-edge graph (titles only, never bodies or provenance), so the static demo export includes it automatically.

- 971a37b: Make the next release jump past the stale npm 0.4.1 build.

  npm's 0.4.1 was published from the pre-reset repo history: it lacks `marrow doctor`, the error-remedy mapping, and ships compiled test files. The repo sits at 0.4.0, so a patch release would collide with it. This minor bump releases the whole fixed group as 0.5.0, carrying everything queued on main (the knowledge graph, freshness, the skeptic, lint and synthesize, and the first-run hardening). Launch preflight now also fails if a packed tarball would ship built test files, so the 0.4.1 mistake cannot repeat.

- b4dbb2b: Surface the date: dated provenance and stale-fact flags.

  Every citation now carries the source date. `trace_to_source` spans gain `createdAt` (when the evidence was captured), so a fact reads as claim plus source plus date. The CLI shows a "verified" date on human-promoted facts, and the console source panel and its copied citation carry the source date.

  Facts also announce staleness. A new `isFactStale` helper marks a decided fact that is past its expiry, or (with no expiry) older than the staleness window, as stale but still safe to build. Task briefs carry `verifiedAt` and a `stale` flag, the CLI shows "stale, reverify", and `marrow truth` adds a next action to reverify decided facts that may be stale. `MARROW_STALE_DAYS` tunes the window (default 365).

### Patch Changes

- 891a5c8: The console adopts the black room design language, matching the landing: cold near-black shell with bone ink, marrow-gold as the single light source, and Archivo Variable (width axis) as the display face for decided truth in place of Fraunces. The light theme stays warm bone paper. The read-only demo's empty connectors state now explains itself instead of offering an action it cannot perform.
- Updated dependencies [6964842]
- Updated dependencies [2b482f5]
- Updated dependencies [4faef7e]
- Updated dependencies [6e5f698]
- Updated dependencies [51efa4a]
- Updated dependencies [9bd4922]
- Updated dependencies [1911b91]
- Updated dependencies [4c3494f]
- Updated dependencies [b5f0486]
- Updated dependencies [36a1bdc]
- Updated dependencies [51627b5]
- Updated dependencies [4a16c48]
- Updated dependencies [9cbee36]
- Updated dependencies [f537d11]
- Updated dependencies [10528df]
- Updated dependencies [a74078e]
- Updated dependencies [2e9a7fa]
- Updated dependencies [b5b85eb]
- Updated dependencies [8a233f8]
- Updated dependencies [60a929a]
- Updated dependencies [9909966]
- Updated dependencies [727932b]
- Updated dependencies [9d265ad]
- Updated dependencies [120e2bd]
- Updated dependencies [971a37b]
- Updated dependencies [54a1bd2]
- Updated dependencies [f442540]
- Updated dependencies [36a1bdc]
- Updated dependencies [bb0be02]
- Updated dependencies [5576ef2]
- Updated dependencies [b4dbb2b]
- Updated dependencies [9daf449]
- Updated dependencies [a9ef473]
- Updated dependencies [8406463]
  - @marrowhq/core@0.5.0
  - @marrowhq/shared@0.5.0

## 0.4.0

### Minor Changes

- Update public links for the 0.4.0 agent decision gate and product truth maintenance release.

### Patch Changes

- Updated dependencies
  - @marrowhq/core@0.4.0
  - @marrowhq/shared@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies
  - @marrowhq/core@0.3.0
  - @marrowhq/shared@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies
  - @marrowhq/core@0.2.1
  - @marrowhq/shared@0.2.1

## 0.2.0

### Minor Changes

- Make what we built reachable, and kill the activation cliff.
  - `marrow web` launches the question-loop UI in a browser from the CLI (the `@marrowhq/web` package is now published and ships a programmatic `startWebServer`).
  - `marrow demo` runs the hero slice end to end with no API key (a scripted model plus a local in-process embedding), the 60-second proof on a fresh install.
  - `marrow ingest` reads meeting transcripts in many formats, WebVTT, SRT, JSON (Otter/Granola/generic), and plain text/markdown, from a file, a whole folder, or stdin, and normalizes each to clean speaker-attributed evidence. `--audio` and `--image` route through the optional transcription/vision providers.
  - Embeddings are now zero-config: when no embedding endpoint is set, a small model (`Xenova/all-MiniLM-L6-v2`) runs in-process, so a model-key-only user can distill with no second endpoint.
  - New MCP tool `check_drift`: a coding agent can scan the working repo against the room's decided facts and get back open questions for any code that contradicts one, the code-time guardrail. Read-only on the code; it never overwrites or creates a decided fact.

### Patch Changes

- Updated dependencies
  - @marrowhq/shared@0.2.0
  - @marrowhq/core@0.2.0
