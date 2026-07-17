# CLAUDE.md

Marrow is the product-context layer for coding agents: it records the product room verbatim as immutable evidence, distills it into statused facts with provenance, and serves task-scoped truth over a CLI and MCP. One Postgres with pgvector is the entire infrastructure; scheduling is cron calling the CLI.

## Sacred rules (never break)

1. Evidence is append-only and immutable. Secrets are scrubbed before the insert because there is no editing after it.
2. Every distilled fact carries a status, a confidence, and a verbatim provenance span. No fact without a quote.
3. Agents propose, humans promote. The only paths to `decided` are a human answering a question or a human authoring a goal. No MCP tool writes any status.
4. Context is task-scoped. Nothing returns the whole brain; `search` stays flat, the graph walk lives inside `prepare_task` only.
5. One Postgres. The graph is an edge table plus recursive CTEs. No graph database, no queue, no daemon.

## Design language

The visual identity is the black room: cold near-black shell, bone ink, marrow-gold as the single light source, Archivo for decided truth, Geist for UI, Geist Mono for evidence. Before touching `packages/web` or `landing/`, read `docs/design-language.md` and hold to it: tokens over hex, gold is action never status, hairlines over shadows, the promote beat owns the one spring. The design language ends with a slop audit, a numbered checklist every UI change passes so the surfaces read made, not generated: no card sprawl, no decorative gradient, no shadow-for-depth, hierarchy from size and ink not bold, one accent, opinionated copy with no hype words. Run it. UI work is not done until it passes that audit and is verified in a real browser in both console themes with reduced motion checked.

## Verification

- Run checks explicitly from the repo root: `pnpm db:migrate`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm smoke:packed`, `node scripts/check-benchmark-drift.mjs`. Never pipe them through tail.
- `pnpm test` passes only when the summary shows `ℹ fail 0` exactly.
- Local database: `export DATABASE_URL=postgres://marrow:marrow@localhost:5432/marrow` (also in `.env.example`).
- Public numbers live in `benchmark/report.json` and are CI-gated; if a change moves them, rerun `pnpm benchmark` and commit the regenerated report.
- No em dashes in prose, code comments, or docs. Plain language, sentence case.
