# @marrowhq/cli

## 0.4.0

### Minor Changes

- Add the agent decision gate and product truth maintenance loop: `marrow loop`, `marrow truth`, MCP `prepare_task`, MCP `maintain_truth`, drift check receipts, and public release wording cleanup.

### Patch Changes

- Updated dependencies
  - @marrowhq/core@0.4.0
  - @marrowhq/shared@0.4.0
  - @marrowhq/web@0.4.0

## 0.3.0

### Minor Changes

- Make the catch real and measurable (PR-17).
  - Added `catch_events` instrumentation table and `dismissed` question status.
  - Replaced whole-repo drift scan with diff-scoped `git diff` parsing and file/line provenance.
  - Added rule + semantic layers for drift detection, with a model-backed precision filter through the provider interface.
  - Added `dismissCatch` human disposition and `catch_dismissed` events.
  - Added a local golden-set eval harness for precision/recall with a zero-false-positives smoke test on synthetic cases.
  - Wired new surfaces into the CLI (`drift --staged/--unstaged/--since`, `dismiss`) and MCP (`check_drift` scope/semantic options, `dismiss_catch`).
  - Bumped to v0.3.0: `check_drift` is no longer experimental.

### Patch Changes

- Updated dependencies
  - @marrowhq/core@0.3.0
  - @marrowhq/web@0.3.0
  - @marrowhq/shared@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies
  - @marrowhq/core@0.2.1
  - @marrowhq/web@0.2.1
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
  - @marrowhq/web@0.2.0

## 0.1.0

### Minor Changes

- a9521d4: v1: The product context layer for coding agents. Ingest the room (transcripts, standups, notes), distill it into decided vs open product truth with provenance, and serve task-scoped context to coding agents over MCP and a CLI. The four public packages release together.

### Patch Changes

- Updated dependencies [a9521d4]
  - @marrowhq/shared@0.1.0
  - @marrowhq/core@0.1.0
