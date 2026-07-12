# Contributing to Marrow

Thanks for being here. Marrow is the product context layer for coding agents: it records the product room verbatim as immutable evidence, distills it into statused facts with provenance, and serves task-scoped truth over a CLI and MCP server. One Postgres with the pgvector extension is the entire infrastructure.

This guide gets you from a clone to a green pull request. It is meant to be skimmed. If anything here disagrees with `CLAUDE.md`, `CLAUDE.md` wins.

## Local setup

Marrow is a pnpm monorepo with five packages (`shared`, `core`, `mcp-server`, `cli`, `web`). You need Node 20 or newer and pnpm 9.

```bash
git clone https://github.com/ElxMaj/marrow && cd marrow
pnpm install
pnpm db:up          # starts a pgvector Postgres in Docker (docker compose up -d)
export DATABASE_URL=postgres://marrow:marrow@localhost:5432/marrow   # also in .env.example
pnpm db:migrate     # applies the schema
pnpm marrow doctor  # greenlights the whole stack in one command
```

`pnpm db:up` runs `docker compose up -d` and gives you a Postgres with pgvector already installed. If you would rather point at your own Postgres, set `DATABASE_URL` at any database where `create extension vector` has run, then run `pnpm db:migrate`.

`pnpm marrow doctor` checks `DATABASE_URL`, Postgres reachability, the schema, and whether a model is configured for distillation. Each failing check prints what to run next, so start here whenever something looks off. Reads and ingestion work with no model key at all; you only need `MARROW_API_KEY` (or an OpenAI-compatible provider) for real distillation. See [.env.example](./.env.example) for every variable.

When you are done for the day, `pnpm db:down` stops the container.

## Run the checks exactly as CI does

CI (`.github/workflows/ci.yml`) spins up a `pgvector/pgvector:pg16` service, sets `DATABASE_URL`, and runs these steps in order. Run the same commands locally from the repo root, and never pipe them through `tail` (that masks per-package failures in the monorepo):

```bash
pnpm db:migrate
pnpm typecheck
pnpm lint
pnpm test
pnpm smoke:packed
node scripts/check-benchmark-drift.mjs   # the benchmark drift gate
```

A few things to know:

- `pnpm test` passes only when the summary shows `ℹ fail 0` exactly. Any non-zero fail count is a red build, even if the run otherwise looks fine.
- `pnpm lint` runs `eslint .` and `prettier --check .`. Run `pnpm format` to fix formatting before you commit.
- `pnpm smoke:packed` packs the CLI and exercises it the way a published install would. Run it whenever you touch packaging, bins, or cross-package wiring.
- Public benchmark numbers live in `benchmark/report.json` and are CI-gated. If your change moves them, rerun `pnpm benchmark` and commit the regenerated report so `check-benchmark-drift.mjs` stays green.

Green locally means green in CI. Please get there before requesting review.

## Sacred rules (never break)

These are the invariants that make Marrow trustworthy. A change that breaks one will not be merged, no matter how useful it is otherwise.

1. **Evidence is append-only and immutable.** Nothing mutates or deletes evidence after the insert. Secrets are scrubbed before the insert because there is no editing afterward. It is always the source for provenance.
2. **Every distilled fact carries a status, a confidence, and a verbatim provenance span.** No fact without a quote. The agent must always be able to tell decided from open.
3. **Agents propose, humans promote.** The only paths to `decided` are a human answering a question or a human authoring a goal. No MCP tool writes any status.
4. **Context stays task-scoped.** Nothing returns the whole brain. `search` stays flat; the graph walk lives inside `prepare_task` only.
5. **One Postgres, no new services.** The graph is an edge table plus recursive CTEs. No graph database, no queue, no daemon, no external broker. Scheduling is cron calling the CLI.

If your idea seems to need one of these to bend, open a feature request first (see below) and describe the tension. That conversation is welcome; a silent violation is not.

## Pull request conventions

- **Branch off `main`.** Keep one logical change per branch.
- **Tests first.** Write or update tests alongside the change, and make sure the full check list above passes before you request review.
- **Add a changeset when a published package changes.** Run `pnpm changeset` and describe the change. The five public packages (`@marrowhq/shared`, `@marrowhq/core`, `@marrowhq/mcp-server`, `@marrowhq/cli`, `@marrowhq/web`) are a fixed group in `.changeset/config.json`, so they version together in one coordinated bump. See [docs/release.md](./docs/release.md) for how releases are cut.
- **Keep changes surgical and in-package.** Touch the smallest surface that solves the problem, and prefer keeping a change inside the package it belongs to.
- **No em dashes or spaced hyphens** in prose, code comments, or docs. Use commas, colons, parentheses, and periods. Plain language, sentence case.
- **UI work is not done until it is verified in a real browser** in both console themes with reduced motion checked. Before touching `packages/web` or `landing/`, read [docs/design-language.md](./docs/design-language.md) and hold to it: tokens over hex, gold is action never status, hairlines over shadows.

The [pull request template](./.github/PULL_REQUEST_TEMPLATE.md) has a short checklist covering the sacred rules, the verification commands, and the changeset. Fill it in before requesting review.

## Reporting bugs and requesting features

- **Feature requests** go through the [feature request template](./.github/ISSUE_TEMPLATE/feature_request.yml). Start with the problem, not the solution, and note how the idea sits with the sacred rules.
- **Bugs** go on the [issue tracker](https://github.com/ElxMaj/marrow/issues). Include what you ran, what you expected, what happened, and the output of `pnpm marrow doctor` so we can see the state of your stack.
- **How-to and usage questions**: read the [documentation wiki](https://github.com/ElxMaj/marrow/tree/main/docs/wiki) first.
- **Security vulnerabilities**: do not open a public issue. Report them privately through a [GitHub security advisory](https://github.com/ElxMaj/marrow/security/advisories/new). See [docs/security.md](./docs/security.md).

## Where the deeper docs live

- [docs/wiki/README.md](./docs/wiki/README.md): the documentation wiki, start here for how-to and usage.
- [docs/design-language.md](./docs/design-language.md): the visual identity for `packages/web` and `landing/`, required reading before any UI change.
- [docs/release.md](./docs/release.md): how the coordinated npm release works.
- [README.md](./README.md): the full product framing, knowledge model, and command surface.

Welcome aboard, and thank you for helping keep the product room reachable to the agents that build from it.
