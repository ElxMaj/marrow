# Marrow Agent Instructions

This repo uses Marrow as the product source of truth for coding agents.

## Non-Negotiables

- Never infer product truth from the codebase alone.
- Never dump the whole brain into context.
- Every product fact you rely on must have status, confidence, and provenance.
- Treat decided facts as buildable.
- Treat open or contested facts as a stop sign.
- Agents may propose. Humans promote.

## Before You Code

Run a task brief:

```bash
marrow loop "<task>"
```

If MCP is available, call `prepare_task` instead of shelling out. Use the user's exact task string.

Read the brief this way:

- `safeToBuild.facts`: decided goals and decisions you may build from
- `askHumanFirst.questions`: open questions the human must answer first
- `askHumanFirst.contestedFacts`: facts that conflict or need resolution
- `provenance`: exact source spans for every fact

If `status` is `ask_human_first`, pause and ask the human. Do not smooth over the conflict.

## While You Code

- Keep the task scoped to the brief.
- Cite the relevant decided fact in your reasoning when it changes implementation.
- Do not create product requirements from repo structure, tests, or naming.
- If you discover new product ambiguity, use `propose_node` or append evidence. Do not mark it decided.

## Before You Finish

Run a drift check against your diff:

```bash
marrow loop "<task>" --check --unstaged
```

Use `--staged` when the final patch is staged. Use `--since origin/main` for branch review.

If check mode returns drift catches:

- Real contradiction: ask the human, then run `marrow accept <questionId> --text "..."`
- False positive or intentional change: run `marrow dismiss <questionId> --reason "..."`

Do not leave catches unexplained.

## Human Maintenance Loop

When the room may be stale, ask the human to run:

```bash
marrow truth
```

Over MCP, call `maintain_truth`. It shows proposed goals, contested facts, gap questions, pending catches, connector health, and next actions.

## Output Discipline

When you report product context, include only the task-relevant facts. For each fact, include:

- title
- status
- confidence
- provenance source and span

No provenance means no claim.
