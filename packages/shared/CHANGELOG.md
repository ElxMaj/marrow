# @marrowhq/shared

## 0.5.0

### Minor Changes

- a74078e: marrow retract: the human-only correction for false memories.

  A standalone false fact could not be corrected: answer() only promotes or
  supersedes inside two-sided conflicts, and dismiss is drift-catch-only, so a
  hallucinated proposal stayed retrievable forever. marrow retract <id>
  --reason "..." marks it retracted: the node keeps its content, provenance,
  and the reason (stored as append-only evidence and linked as provenance),
  but stops surfacing in keyword search, semantic search, and neighbor walks.
  It stays fully inspectable by id and in traces: invalidation of retrieval,
  never erasure. A decided fact is refused without --force, since settled
  truth is normally replaced through the answer loop. There is deliberately NO
  MCP tool: agents cannot retract, which is the promote gate's mirror.
  Migration 0016 adds the status to the four node tables.

- b5b85eb: Add the knowledge graph edge, the foundation for walked retrieval.
  - New `edge` table (migration 0013): a directed, typed link between two distilled nodes (concerns, serves, supersedes, refines, conflicts_with, relates_to), walked by a recursive CTE in the one Postgres, never a separate graph database. An edge carries a confidence and a source, never a status, and never promotes a node.
  - `Edge`, `Relation`, and `EdgeNodeKind` schemas in the shared spine.
  - Store graph API: `insertEdge` (idempotent on the from/to/relation triple), `neighbors` (a bounded, both-directions, multi-hop walk), `edgesFor`, `degree`, `degrees`, and `listEdges`. No retrieval behavior changes yet: edges are written and walked by later work.

- 727932b: Write-time near-duplicate guard for decisions and goals.

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

- 971a37b: Make the next release jump past the stale npm 0.4.1 build.

  npm's 0.4.1 was published from the pre-reset repo history: it lacks `marrow doctor`, the error-remedy mapping, and ships compiled test files. The repo sits at 0.4.0, so a patch release would collide with it. This minor bump releases the whole fixed group as 0.5.0, carrying everything queued on main (the knowledge graph, freshness, the skeptic, lint and synthesize, and the first-run hardening). Launch preflight now also fails if a packed tarball would ship built test files, so the 0.4.1 mistake cannot repeat.

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
