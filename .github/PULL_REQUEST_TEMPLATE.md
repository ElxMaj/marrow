<!-- Keep this tight. Fill in each section and check the boxes before requesting review. -->

## What and why

One line on what this changes and why.

## Sacred rules check

- [ ] This change keeps the sacred rules: only a human answer or a human goal can write `decided` status (no MCP tool writes any status), evidence stays append-only and immutable (nothing mutates or deletes it), and it adds no new infrastructure beyond the one Postgres with pgvector.

## Verification

Run from the repo root, never piped through tail.

- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` passes.
- [ ] `pnpm test` passes at the repo root with the summary showing `ℹ fail 0`.
- [ ] `pnpm smoke:packed` passes (if packaging changed).

## Changeset and prose

- [ ] Added a changeset (`pnpm changeset`) if a published package changed.
- [ ] No em dashes in prose, code comments, or docs. Plain language, sentence case.
