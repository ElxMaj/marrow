# Marrow 2027 retest audit

Retest of shipped `main` (commit 1ed8138, PR #104), 8 dimensions, run as a multi-agent adversarial pass (a finder per dimension plus an independent verifier per critical or failing claim; the verifier's corrected verdict wins on disagreement). Two load-bearing claims (R5 already ships, R8 span-bounds hole) were then re-confirmed by hand. This document is written to be acted on.

## Verdict

Shipped Marrow is architecturally world-class. All five sacred rules hold on `main`, retrieval and benchmark honesty hold, the second-brain arc (freshness, skeptic, lint, synthesize) holds, and the CLI/MCP surface has no path that writes a decided status.

It is **not world-class as shipped**, and the reason is narrow and specific: four high-severity write-side integrity fixes are finished and green but gated behind founder review, so `main` still carries the gaps. One of them (R8) leaves a sacred-rule-2 hole reachable from an agent-facing path. The bar this retest was held to is explicit: the product is not world-class as shipped if any critical or high write-side integrity gap remains on `main` because its fix is gated. Four do. Do not soften this.

No regressions. Nothing that previously shipped is broken. Every gap below is either an original unmet promise with a gated fix, or a genuine low-severity gap.

## The three categories

### (a) Shipped and holds

- **Sacred rule 1 (append-only, scrubbed evidence).** `insertEvidence` (store.ts) is the single choke point; it scrubs (default-on) before the INSERT, and the evidence table takes INSERT only. Zero UPDATE/DELETE on evidence anywhere. `getEvidence` is a pure SELECT.
- **Sacred rule 2 (no fact without a span), at schema and distill level.** `ProvenanceSchema.min(1)` (spine.ts) is enforced in all four store insert paths and in MCP `propose_node`. The auto-distill path resolves each quote and drops any node whose span does not resolve. The residual hole is the non-distill write path; see R8 under gated.
- **Sacred rule 3 (agents propose, humans promote).** The only writers of `status='decided'` / `source='human'` are `promoteToDecided` (via the human `answer` / `acceptCatch` path) and the sanctioned human-only `authorGoal` (reached from CLI and the web console, never MCP). All MCP tools are read-only or propose open, model-confidence nodes; `propose_node` has no status field; `accept_catch` / `dismiss_catch` record without deciding. Verified independently and could not be refuted.
- **Sacred rule 4 (task-scoped context).** `search()` / `runSearch` is strictly flat. The retrieval graph walk lives only inside `prepareTask` (bounded 2 hops, neighbor limit 50). `get_neighbors` is a deliberate bounded, single-node navigation primitive. `prepare_task` is capped per category, never the whole brain.
- **Sacred rule 5 (one Postgres).** Only data client is `pg`; zero redis / kafka / queue / graph-db deps across every package.json; docker-compose declares one pgvector service.
- **Retrieval + benchmark honesty.** The graph-walk boosts live inside `prepareTask` while flat search stays flat, so the marketed flat 2.9x / brief 1.5x / recall 1.0 / noiseRatio 0.48 are measured on real returned slices via a deterministic keyless embedder and reproduce arithmetically. The CI drift gate regenerates a fresh report and diffs deterministic fields only (latency stripped). Nothing env-dependent leaks into token counts.
- **R5 keyless semantic search.** Genuinely ships and holds on `main`: `LocalEmbeddingProvider` is wired into `createEmbeddingProvider` (marrow.ts:2706). A Claude-key-only user gets semantic search with no embedding API key. Note: the retest found the R5 substance already on `main`, so PR #89 refines rather than introduces it; confirm what #89 adds (opt-out flag, degradation notice, tests) before treating keyless search as an outstanding gate.
- **Second-brain arc.** `verified_at` is stamped only by the human promotion path; confidence is never decayed in place; staleness is a derived read-time boolean surfaced in briefs; the skeptic (`verify`), `lint`, and `synthesize` are pure rule-only, read-only advisories that escalate contradictions to human questions but never promote. The MCP `verify` tool cannot decide.
- **CLI + MCP surface.** The second-brain verbs (graph, map, neighbors, verify, lint, synthesize, truth) with per-command help, an Environment section, and product-voice ENOENT handling; `doctor` checks DATABASE_URL, Postgres, schema, model, and connector secrets. MCP tools are hop/limit-bounded; no get-everything tool; no promote path.
- **API hygiene (Node server).** Typed 4xx (400 / 404 / 405 + Allow header / 413), a single generic 500 that logs server-side and leaks no stack, and read-only demo mode 403s every write path before parsing.
- **UI / anti-slop.** Hand-rolled, dependency-free SVG living map over a from-scratch force layout (no d3 / cytoscape / reactflow); honest `seededAt` banner over a realistic timeline; a real 390px mobile-overflow probe wired into CI; a numbered slop audit plus banned-hype-word copy voice wired as a hard gate by both CLAUDE.md files.
- **Growth surface.** Waitlist is a plain anchor to a working GitHub Discussions target; canonical / og / twitter / JSON-LD / llms.txt all derive from the real marrow-six / marrow-live-demo surfaces, never the hijacked marrowhq.com; og.png exists; README leads with an unpinned npx quickstart; `check-ids.mjs` is a real provenance gate in CI.

### (b) Fix implemented but gated behind founder review

These are done and green on their branches; they are absent from `main` because the merge is gated. Each is an original unmet promise, not a regression.

| Ref | PR | Severity | Gap on `main` | Fix |
| --- | --- | --- | --- | --- |
| R8 | #93 | high (write-side, sacred rule 2) | `insertProvenance` writes span_start / span_end with only a lower-bound DB check and no evidence-length upper bound. MCP `propose_node` validates spans only as nonnegative ints, so an agent can propose start/end past the text length; the fact stores and its read-time `evidence.text.slice(start,end)` is empty. A fact with no verbatim quote. | Evidence-length lookup and out-of-bounds rejection inside `insertProvenance`, plus a hygiene query for legacy rows. |
| R11 | #96 | high (write-side) | All mutating POSTs in `packages/web/src/api.ts` dispatch on `req.method` alone with no Origin / Referer / Sec-Fetch check. The 127.0.0.1 default is partial mitigation only; `MARROW_WEB_HOST` can bind 0.0.0.0, and a malicious browser page can cross-site POST to the loopback port to promote or ingest into the local brain. | A same-origin check, an allow-origin whitelist, and rejection of cross-origin writes, with a covering test. |
| R6 | #90 | high (write-side) | `runDemoCommand` and `runDemo` ingest / distill / promote into whatever `DATABASE_URL` points at, with no emptiness or demo-scope check. `marrow demo` against a real brain pollutes it with decided facts. | Refuses to write into a brain that holds anything real, and refuses to re-run into a brain it already ran in unless forced. |
| R9 | #94 | high | `marrow drift --ci` sets `hasDrift` from `result.created` only, and `driftScan` skips any decision+hunk signature already surfaced. A second run over the same still-contradicting diff yields `created=[]`, so it exits 0 while the catch is still open. The CI integrity gate is launderable by re-running. | Gate stays red (non-zero exit) while an open catch matches the current diff. |

Four newer PRs are green and mergeable but unmerged. None is an integrity blocker; all are finished shipped-quality work waiting on a founder call:

- **#105** (R19): named humans on every promote.
- **#106**: Overview leads with a decided hero, not four equal cards (anti-slop).
- **#107**: agent template refreshed to the shipped brain.
- **#108** (R22): `marrow truth --html`, the morning read as a self-contained artifact.

### (c) Genuine gaps

- **Two raw-hex exceptions in styles.css.** Fixed in this retest PR: `.toast` and `.chip.warn.active` now use theme-aware `--decided-ink` / `--contested-ink` tokens. The `.toast` case was more than cosmetic: `#10231a` (dark ink) on the `var(--decided)` fill was low-contrast in the light theme, where that fill is dark forest green.
- **Serverless API-hygiene asymmetry (low).** The Vercel serverless handlers have no top-level error classifier: oversized body and bad JSON surface as 500 (not 413 / 400), and a core not-found returns 500 (not 404). Mitigated because the hosted demo is read-only. But `trace/[nodeId].ts` is a GET with no read-only guard, so an unknown id returns 500 on the live demo where the Node path would return 404. Tracked for a follow-up; not a blocker.
- **"Survivors are ranked up" is not fully implemented (low).** Retrieval boost is seed/neighbor-based, not verdict-based; survivor verdicts are recorded as advisory rows but do not lift a fact in retrieval ordering. The never-promoted guarantee still holds; only the descriptive claim overreaches. Reconcile the claim or implement the ranking.
- **Human-authored decided goals carry no `verified_at` (design nuance).** `authorGoal` inserts via `insertGoal`, which does not stamp `verified_at`; staleness falls back to `updatedAt`. Consistent with the literal promise; noted as an asymmetry, not a defect.

## What a founder should do

1. Merge the four gated write-side fixes to clear the world-class bar: **#93 (R8)** and **#96 (R11)** first, since R8 breaches sacred rule 2 from an agent path and R11 exposes cross-site writes, then **#90 (R6)** and **#94 (R9)**.
2. Confirm what **#89** adds over the keyless search that already ships on `main`, and either fast-track or close it so the roadmap stops treating keyless search as outstanding.
3. Decide the four green quality PRs (**#105 to #108**) so finished work stops aging in review.
4. The genuine gaps in (c) are low; the raw-hex one is fixed here, the rest are tracked.

Once #90 / #93 / #94 / #96 are on `main`, this audit's blocking objection is resolved and shipped Marrow clears the world-class bar on write-side integrity.
