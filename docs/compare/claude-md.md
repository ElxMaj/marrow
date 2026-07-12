# Marrow vs "just put it in CLAUDE.md"

The strongest competitor is not a product. It is the instruction file you
already have: CLAUDE.md, AGENTS.md, .cursorrules. For a small project with a
handful of stable rules, that file is genuinely enough, and Marrow's own
README tells you to keep using it for exactly that. This page is about where
the file stops working.

## The always-paid tax

An instruction file reloads in full on every session, whether the task needs
it or not. Every fact you add taxes every future run, so the file either
stays small (and forgets most of the room) or grows (and pays for itself on
every prompt). Marrow inverts this: the agent instruction file stays three
lines, and `prepare_task` pulls a task-scoped slice per task. Measured on the
labeled corpus, the full brief loads 1.5x fewer tokens than dumping the
corpus, and a flat task search 2.9x fewer, at recall 1.0 on the labeled
relevant nodes (committed in [benchmark/report.json](../../benchmark/report.json),
reproduced by `marrow eval --all`).

## What a file cannot do

| The file | Marrow |
| --- | --- |
| One blob, no per-fact status | Every fact carries open, decided, contested, superseded, or retracted |
| Edits overwrite history | Replacements are recorded: `marrow history` shows what replaced what, when, and the answer that justified it |
| No provenance | Every fact traces to the verbatim span it came from |
| Goes stale silently | Freshness dates, staleness flags, a weekly digest of what changed, and a drift check against the code |
| Anyone (or any agent) can edit it | Agents can only propose; a fact becomes decided only through a human answer |
| No dedup | Restatements merge at write time; near-duplicates get a question |
| Contains whatever was pasted | Secrets scrubbed before storage; instruction-shaped text flagged on every quoting surface |

## When the file is the right answer

Fewer than a dozen stable rules, one repo, one or two people, no history
worth keeping: keep the file, skip the database. Marrow starts paying for
itself when decisions change over time, when more than one person (or agent)
writes, and when "why did we decide this" is a question anyone actually asks.
The wire-in is three lines in that same instruction file; the room moves to
Postgres, the file stops growing.
