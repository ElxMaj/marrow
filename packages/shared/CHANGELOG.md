# @marrowhq/shared

## 0.4.0

### Minor Changes

- Support the 0.4.0 agent decision gate and product truth maintenance release.

## 0.3.0

## 0.2.1

## 0.2.0

### Minor Changes

- Make what we built reachable, and kill the activation cliff.
  - `marrow web` launches the question-loop UI in a browser from the CLI (the `@marrowhq/web` package is now published and ships a programmatic `startWebServer`).
  - `marrow demo` runs the hero slice end to end with no API key (a scripted model plus a local in-process embedding), the 60-second proof on a fresh install.
  - `marrow ingest` reads meeting transcripts in many formats, WebVTT, SRT, JSON (Otter/Granola/generic), and plain text/markdown, from a file, a whole folder, or stdin, and normalizes each to clean speaker-attributed evidence. `--audio` and `--image` route through the optional transcription/vision providers.
  - Embeddings are now zero-config: when no embedding endpoint is set, a small model (`Xenova/all-MiniLM-L6-v2`) runs in-process, so a model-key-only user can distill with no second endpoint.
  - New MCP tool `check_drift`: a coding agent can scan the working repo against the room's decided facts and get back open questions for any code that contradicts one, the code-time guardrail. Read-only on the code; it never overwrites or creates a decided fact.

## 0.1.0

### Minor Changes

- a9521d4: v1: The product context layer for coding agents. Ingest the room (transcripts, standups, notes), distill it into decided vs open product truth with provenance, and serve task-scoped context to coding agents over MCP and a CLI. The four public packages release together.
