# Welcome to the Marrow wiki

Hello from the Customer Success team. This wiki is the map of everything Marrow does today, written for the engineers who will run it. Every page follows the same rule we ask of Marrow itself: no claim without something concrete behind it, whether that is a command, an MCP tool, or a config file. Start here, pick the reading order that matches your role, and reach out to us when a page leaves you with a question.

## What Marrow is

Marrow is a product memory for your team: it keeps what your team has actually said and decided, and serves it back with receipts. It runs on nothing but Postgres with the pgvector extension and, when you want real distillation, one model key. There is no hosted product in this repository; you self host it, and a local demo runs end to end with no API key at all:

```bash
pnpm marrow demo
```

## The 60-second mental model

Five ideas explain the whole system.

1. **Your team talks.** Meetings, interviews, Slack threads, docs. You feed that in:

   ```bash
   pnpm marrow ingest ./meetings
   ```

2. **Marrow records the words verbatim as evidence.** Evidence is the raw text, stored append-only. It is never edited and never deleted. Secrets are scrubbed before it is written (things like API keys become `[redacted:kind]`), but the words themselves are never rewritten.

3. **A model distills proposals from the evidence.** Distillation extracts entities, decisions, goals, and questions. Every extracted item must cite an exact span of the original evidence, called provenance. If the model cannot point to the words, the item is dropped. Everything the model produces starts with status `open`: it is a proposal, not truth.

4. **Only a human makes something decided.** Marrow raises questions when it finds gaps or conflicts. When a human answers one, the answer itself is stored as new evidence and the fact is promoted to `decided`. The one other path to `decided` is just as human: writing a goal directly with `marrow goal author`. Agents have neither path. To see what is waiting for a human:

   ```bash
   pnpm marrow questions
   ```

   Humans can also retract a fact, with a recorded reason, via `marrow retract <nodeId> --reason "..."`.

5. **Agents get a task-sized brief, not the whole brain.** Before a coding agent starts a task, it calls the `prepare_task` MCP tool (or you run the command below) and gets a short brief: decided facts that are safe to build on, contested facts, and open questions to take to a human first.

   ```bash
   marrow loop "add CSV export to the billing page"
   ```

That is the loop. Words in, evidence kept forever, proposals distilled, humans decide, agents build on what is decided.

## Suggested reading orders

**If you are evaluating whether to adopt Marrow.** Read [What Marrow is](./what-is-marrow.md) for the honest scope, then [Core concepts](./core-concepts.md) for the data model, then [How we measure memory](./measuring-memory.md) to see how we judge whether it works. If you are comparing tools, the notes at [../evaluating-agent-memory.md](../evaluating-agent-memory.md) may help.

**If you are an engineer wiring it in.** Read [Getting started](./getting-started.md) and run the demo, then [Working with agents](./working-with-agents.md) for the three-line snippet that goes in your `CLAUDE.md` or `AGENTS.md`, then [CLI reference](./cli-reference.md). Keep [Search and retrieval](./search-and-retrieval.md) nearby for how briefs are built.

**If you are an operator running it week to week.** Read [How knowledge flows](./how-knowledge-flows.md) so you know what each status means, then [Keeping the brain healthy](./maintenance.md) for the lint, verify, and synthesize loops (they are plain CLI commands a scheduler calls, cron is enough), then [Trust and safety](./trust-and-safety.md) for scrubbing, injection smells, and the policy file at `.marrow/policy.json`. When you wire in Slack or GitHub, [the connectors guide](../connectors.md) has the per-service setup.

## Page map

- [Welcome to the Marrow wiki](./README.md): this page, the map and the mental model.
- [What Marrow is](./what-is-marrow.md): the plain description, what ships today, and what does not.
- [Getting started](./getting-started.md): clone, `pnpm db:up`, `pnpm db:migrate`, demo, and the `.env` settings that matter.
- [Core concepts](./core-concepts.md): evidence, entities, decisions, goals, questions, statuses, and provenance.
- [How knowledge flows](./how-knowledge-flows.md): the path from raw words to decided facts, and how facts get contested, superseded, or retracted.
- [Working with agents](./working-with-agents.md): the MCP server, `prepare_task`, the web console, and the wire-in snippet for your agent files.
- [CLI reference](./cli-reference.md): every `marrow` command with real invocations.
- [Search and retrieval](./search-and-retrieval.md): semantic search, the graph walk, and how a task brief is assembled.
- [Keeping the brain healthy](./maintenance.md): lint, verify, synthesize, staleness, and scheduling with cron.
- [Trust and safety](./trust-and-safety.md): secret scrubbing, prompt-injection smells, retraction, and `.marrow/policy.json`.
- [How we measure memory](./measuring-memory.md): what we count and why, so you can hold us to it.
- [FAQ and troubleshooting](./faq-and-troubleshooting.md): common questions, plus `marrow doctor` for setup problems.

## A note on honesty

Two things to know before you dive in. First, the npm packages under the `@marrowhq` scope exist, but the published build is currently stale, so the git clone path is the recommended first run today; [Getting started](./getting-started.md) walks through it. Second, Marrow works in a keyless mode for reads and ingestion (embeddings run locally with no key), but real distillation needs a model key in `MARROW_API_KEY` or an OpenAI-compatible endpoint. The docs always say which mode a feature needs.

## Keep reading

- [Getting started](./getting-started.md)
- [Core concepts](./core-concepts.md)
- [Working with agents](./working-with-agents.md)
