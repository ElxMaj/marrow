# @marrowhq/mcp-server

## 0.5.0

### Minor Changes

- 51efa4a: No agent path to a status write: MCP accept_catch and dismiss_catch record,
  never close.

  The MCP accept_catch tool promoted a drift question to decided (stamped
  human-confident) from a pure agent tool call, and dismiss_catch could silence
  an alarm the same way. That was both a hole in the promote gate and the
  sharpest injection target: an instruction embedded in retrieved evidence
  could tell the agent to accept its own drift catch.

  Both tools now call recordCatchResolution: the reaction is stored as
  append-only evidence plus a catch event with trigger 'agent', the pending
  list clears (someone reacted), but the question stays open. Closing it stays
  a human act through the CLI (marrow accept / marrow dismiss), and the
  human-labeled catch metrics exclude agent-triggered events, so agents cannot
  inflate their own precision. After this change no MCP tool writes any status
  beyond proposing open nodes.

- 36a1bdc: marrow history: the replacement lineage, made visible.

  Every conflict resolution already stored the winner, the loser, the date,
  and the answer that justified it; nothing walked it. marrow history <id>
  and the read-only MCP get_history tool lay the supersedes chain out oldest
  first, each entry with its replacement date and reason excerpt and the
  current head marked, readable from any link in the chain. Question
  endpoints are filtered (an answered question is closed, not replaced), the
  walk is bounded, and superseded entries stay fully reachable: invalidation,
  not erasure, as a surface instead of a slogan.

- 9cbee36: Add a front-door index: see what exists before searching.
  - Core `getIndex(limit)` (store `listIndex`) returns a bounded list of every node as id, kind, one-line title, status, and degree (how connected it is), the hubs first. Titles only, never bodies or provenance, so it shows what exists without being the whole brain.
  - MCP tool `get_index` and CLI `marrow map [--limit N]` expose it, so an agent or a developer gets an overview of the brain and its most connected nodes at a glance.

- 51e2b44: append_evidence distills inline: what an agent writes is retrievable in the
  same session.

  The MCP write path always deferred distillation, so an agent's own
  mid-session write was invisible to its very next search: the
  user-tells-agent, agent-forgets loop. append_evidence now distills inline by
  default when a model is configured (distill: false defers and names the
  drain command). Distillation only proposes OPEN nodes, so the tool still
  cannot decide anything, and the write-time near-duplicate guard applies to
  what it creates.

- 9d265ad: Add a neighbor surface: read a node's place in the knowledge graph.
  - Core `getNeighbors(nodeId, maxHops)` returns a node and the nodes linked to it, each with the relation, hop distance, status and title. Bounded (never the whole brain) and read only.
  - MCP tool `get_neighbors` and CLI `marrow neighbors <id> [--hops 1|2]` expose it, so an agent or a developer can walk from a fact to the decisions about it, the goal it serves, or the facts it conflicts with or supersedes.

- 120e2bd: Fix the published first run and harden the developer experience.
  - `marrow migrate` sets up or updates the schema, and `marrow demo` now migrates itself, so the advertised `npx @marrowhq/cli demo` works on a bare Postgres with no clone. The database error hints point at `marrow migrate` instead of pnpm-only scripts a published-bin user does not have.
  - `marrow doctor` greenlights DATABASE_URL, Postgres reachability, schema, and model readiness in one command, with a remedy per failing check and a `--json` mode.
  - CLI status color: decided is green, open yellow, contested red, superseded dim. Gated on a TTY and NO_COLOR so piped output and CI stay byte-clean.
  - The MCP server reports its real package version instead of 0.0.0, ships agent instructions (decided vs open, propose not decide, trace before you build), and returns named validation errors instead of a raw zod blob.
  - Help accuracy: `ingest` and `add` both note they distill by default, `add` honors `--no-distill`, `answer` documents `--decide`, and a breadcrumb points at the MCP server.
  - Published package metadata: keywords, homepage, bugs, and author on all packages.

- 971a37b: Make the next release jump past the stale npm 0.4.1 build.

  npm's 0.4.1 was published from the pre-reset repo history: it lacks `marrow doctor`, the error-remedy mapping, and ships compiled test files. The repo sits at 0.4.0, so a patch release would collide with it. This minor bump releases the whole fixed group as 0.5.0, carrying everything queued on main (the knowledge graph, freshness, the skeptic, lint and synthesize, and the first-run hardening). Launch preflight now also fails if a packed tarball would ship built test files, so the 0.4.1 mistake cannot repeat.

- bb0be02: Add the skeptic: a fresh-context verify gate over proposed facts.

  `marrow verify` (and the MCP `verify` tool) attacks every open, model-proposed fact with a fresh context: it sees only the node's own evidence and the decided facts it might contradict, never the conversation that proposed it. It flags a proposal that is single-source, weakly-sourced (a tiny span or low confidence), or contradicts a decided fact, records an append-only verdict (migration 0015), and raises a normal question on a contradiction. It never promotes a fact: this reinforces the propose/promote gate rather than bypassing it, and no verdict ever changes a node's status. The reason logic lives in a pure `skeptic.ts` so it is testable in isolation.

- d0e832b: Quoted evidence is framed as untrusted data on every agent surface.

  Verbatim evidence spans reached agents with no framing anywhere: an
  instruction embedded in an ingested transcript would be quoted straight into
  a task brief with nothing marking it as data. Now the MCP server instructions
  say plainly that quoted spans are records, never instructions to follow; the
  three tools that quote spans (trace_to_source, prepare_task, maintain_truth)
  prepend exactly one fixed sentence to their results and say so in their
  descriptions; and the CLI labels quotes "Source (verbatim record)". One short
  line, only on the tools that quote, so the reminder never taxes ordinary
  reads.

### Patch Changes

- f442540: Scrub secrets before the append, because there is no after.

  Evidence is immutable by design, so an API key that reached the insert was
  frozen in the brain forever. Every evidence insert now runs a conservative
  credential detector (AWS keys, GitHub and Slack tokens, sk- provider keys,
  JWTs, PEM private-key blocks, and password/token/api_key assignments with a
  digit in the value) and replaces each match with a visible [redacted:kind]
  placeholder. The scrub lives in the store's insertEvidence, the single choke
  point every writer goes through: ingest, connector sync, and answer
  resolutions included. CLI receipts and the MCP append_evidence result report
  how many secrets were caught. MARROW_SCRUB=off opts out.

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

- Add the agent decision gate and product truth maintenance loop over MCP with `prepare_task` and `maintain_truth`, plus updated package metadata.

### Patch Changes

- Updated dependencies
  - @marrowhq/core@0.4.0
  - @marrowhq/shared@0.4.0

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

## 0.1.0

### Minor Changes

- a9521d4: v1: The product context layer for coding agents. Ingest the room (transcripts, standups, notes), distill it into decided vs open product truth with provenance, and serve task-scoped context to coding agents over MCP and a CLI. The four public packages release together.

### Patch Changes

- Updated dependencies [a9521d4]
  - @marrowhq/shared@0.1.0
  - @marrowhq/core@0.1.0
