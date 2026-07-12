# What Marrow is

Marrow is a product-context layer for coding agents. It lives in one Postgres database and does two things: it turns what your team says (interviews, meetings, threads) into a small set of traceable product facts, and it serves the relevant slice of those facts to your agent right before a task. Agents can propose facts, but only a human decision makes anything true. This page explains the problem Marrow solves, the three promises it makes, who it is for, and what it deliberately does not do.

## The problem

Coding agents forget everything between sessions. Every new session starts from zero product knowledge, so the agent re-infers your product's intent from the code, and the code does not know why decisions were made.

The usual fix is an instruction file: a `CLAUDE.md` or `AGENTS.md` that you keep appending to. That works at first. Over time it becomes a tax you pay on every request: the whole file rides along on every turn, whether or not it is relevant, and nobody remembers which lines are still true.

The other fix is a memory product that writes whatever the agent found interesting. Those fill up with junk: unverified claims, duplicates, stale facts that quietly contradict newer ones, and no way to check where any of it came from.

Marrow is built around the failure modes of both.

## What Marrow is

Marrow is open source and self-hosted. The only infrastructure is one Postgres 16 or newer with the pgvector extension: no graph database, no Redis, no queue, no daemon. Maintenance loops are plain CLI commands that a scheduler (GitHub Actions cron or system cron) calls.

It ships as two packages, a CLI (`@marrowhq/cli`) and an MCP server (`@marrowhq/mcp-server`). MCP is the Model Context Protocol, the standard way tools plug into agents like Claude Code. One honest note: the build currently published on npm is stale, so today the recommended path is cloning the repository and running from source. See [Getting started](./getting-started.md) for the exact steps, but the shape is:

```bash
git clone https://github.com/ElxMaj/marrow && cd marrow
pnpm install
pnpm db:up
pnpm db:migrate
pnpm marrow demo
```

`pnpm marrow demo` runs the whole loop end to end with no API key: it ingests a sample interview, distills it into facts, and shows a decided fact with its provenance.

## The three promises

**Every fact traces to the verbatim words it came from.** Raw source text is stored as immutable evidence. When Marrow's distillation step extracts a decision or a goal from it, the extracted item must resolve to an exact character span inside that evidence. If no span can be found, the item is dropped, never stored. There is no trust-me fact. You can follow any fact back to its exact quote with the `trace_to_source` MCP tool, or ingest and inspect from the CLI:

```bash
pnpm marrow ingest ./meetings
pnpm marrow truth
```

**Agents propose, humans decide.** Distillation only ever writes facts with status `open` and model confidence. The only paths to `decided` are human: answering an open question, or authoring a goal directly with `marrow goal author`. Nothing agent-facing can write a decided fact, and there is deliberately no MCP tool for retracting one either. You review the queue yourself:

```bash
pnpm marrow questions
pnpm marrow web    # the local human console
```

**Context is served per task, never the whole brain.** Before a task, the agent calls the `prepare_task` MCP tool (or you run `marrow loop "<task>"`) and gets a small capped brief: the decided facts and goals relevant to that task, plus any open or contested items it should ask a human about first. The whole knowledge base never rides along. The wire-in is three lines in your `CLAUDE.md` or `AGENTS.md`; see [Working with agents](./working-with-agents.md).

```bash
pnpm marrow loop "add soft delete to workspaces"
```

## Who it is for, and who should keep a CLAUDE.md

Marrow is for teams where product decisions accumulate faster than one file can hold them: several people making calls in meetings and threads, agents doing real implementation work, and a history of "wait, didn't we decide the opposite of that?"

If that is not you, keep the file. A solo maintainer, a small stable product, or a team whose durable decisions fit comfortably on one page is genuinely better served by a well-kept `CLAUDE.md`. It is simpler, it needs no database, and Marrow's own comparison doc says so plainly: [versus CLAUDE.md](../compare/claude-md.md).

## What Marrow does not do

An honest list, straight from the docs:

- **No hosted cloud.** You bring your own Postgres. Hosted product work happens outside this open source repository.
- **No per-user or per-session memory scoping.** Marrow is one brain per product per database, deliberately. If you need Mem0-style per-user memory, Marrow is not that.
- **Deletion completeness for secrets is not shipped.** Secrets are scrubbed before evidence is written (evidence is append-only, so scrubbing happens before the append). A human-only redaction command for anything that slips through is planned but not shipped yet; [Trust and safety](./trust-and-safety.md) has the workaround until then.
- **The skeptic is rule-based today.** `marrow verify` challenges proposed facts on rules (single source, weak provenance, contradiction with decided facts, instruction-shaped text). A model-based deep pass is a noted follow-up.
- **Keyless search is keyword search.** With no embedding provider configured, search matches substrings, not paraphrases; [Search and retrieval](./search-and-retrieval.md) explains both modes.

For the full head-to-head against write-anything memory products, read [versus Mem0 and Zep](../compare/mem0-zep.md).

## Keep reading

- [Getting started](./getting-started.md): install, first run, and the demo.
- [Core concepts](./core-concepts.md): evidence, facts, statuses, and provenance in detail.
- [How knowledge flows](./how-knowledge-flows.md): the path from raw words to decided truth.
