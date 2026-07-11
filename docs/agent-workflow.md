# Agent Workflow

Marrow should sit in the coding loop, not beside it. The point is simple: before an agent changes code, it reads the product truth for that task. After it changes code, it checks whether the diff contradicts anything the room decided.

## Wire it in (three lines)

The fastest way to put an agent in the loop is three lines in the project's `CLAUDE.md`, `AGENTS.md`, or equivalent:

```markdown
## Product context (Marrow)
- Before any task, call prepare_task (or run `marrow loop "<task>"`) for decided vs open product truth with provenance.
- Build only on decided facts. For open or contested ones, ask a human. Never infer product intent from the code.
```

Keep the instruction file short and pointing at Marrow rather than carrying the room inside it. The context window is metered, so the room belongs on disk and only the task-scoped slice belongs in the prompt. The full ritual below is optional. These three lines are enough to start.

## The Daily Loop

Run this at the start of the day or before planning work:

```bash
marrow truth
```

The maintenance brief tells the human what needs attention:

- decided product and user goals that define the current source of truth
- proposed goals waiting for promotion or rejection
- contested goals or decisions
- unanswered gap questions, especially goals without a served feature
- drift catches waiting for accept or dismiss
- stale or broken connectors
- next human actions

The human owns this loop. Agents can propose, but only humans promote facts to decided.

## Before Coding

For every task, ask Marrow for the task brief:

```bash
marrow loop "implement password login"
```

The agent should treat the brief as a gate:

- **Safe to build**: decided goals and decisions with provenance. Build from these.
- **Ask a human first**: open questions or contested facts. Do not guess through these.
- **Provenance**: every fact must trace to an exact span. No provenance, no product truth.

Over MCP, call `prepare_task` with the same task string. This is the preferred path for Claude Code, Codex, Cursor, or any MCP host because the agent receives structured JSON instead of a pasted terminal transcript.

## After Coding

Before asking for review, run the same loop in check mode:

```bash
marrow loop "implement password login" --check --unstaged
```

Use `--staged` after staging, or `--since origin/main` in CI-style review. The check runs the drift engine and returns:

- created drift questions
- catch event ids
- sanitized receipt data
- accept and dismiss commands

If it catches real drift, accept it with the human answer:

```bash
marrow accept <questionId> --text "The current source of truth is ..."
```

If the catch is not a product contradiction, dismiss it with a reason:

```bash
marrow dismiss <questionId> --reason "Not product drift because ..."
```

## Team Rollout

1. Put product-room evidence into Marrow: interviews, standups, planning notes, decision logs, and whiteboards.
2. Run `marrow truth` with the product owner until the current goals and decisions are decided.
3. Add the MCP server to each agent host.
4. Paste [templates/AGENTS.marrow.md](../templates/AGENTS.marrow.md) into the repo's `AGENTS.md`, `CLAUDE.md`, or equivalent agent instruction file.
5. Require `marrow loop "<task>"` before implementation and `marrow loop "<task>" --check` before review.
6. Keep connector health clean so the room does not go stale.

## MCP Tool Contract

Agents should start with:

- `prepare_task`: task-scoped brief before coding, optional drift check after coding
- `maintain_truth`: human maintenance brief

Agents may then use lower-level tools when they need more detail:

- `search`
- `get_decisions`
- `get_goals`
- `get_open_questions`
- `get_entity`
- `trace_to_source`
- `append_evidence`
- `propose_node`
- `check_drift`
- `accept_catch`
- `dismiss_catch`

Do not replace `prepare_task` with a broad search. The sacred rule is task-scoped context, not a whole-brain dump.

## Launch Note

Until npm latest matches the repo package version, use the local clone commands from the README (`pnpm marrow ...`) or packed packages for demos. `pnpm launch:preflight` reports whether npm, CI, DNS, Vercel, and package metadata are ready for public launch.
