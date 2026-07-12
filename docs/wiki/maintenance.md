# Keeping the brain healthy

Marrow does not need a daemon, a dashboard, or a person watching it. It needs a short weekly rhythm: run the linter, run the skeptic, read the digest, drain the backlog. Every command on this page is read-only or additive. Nothing here deletes knowledge, and nothing here resolves a question on your behalf. Humans decide; these tools just make sure you know what needs deciding.

## The weekly rhythm at a glance

1. `marrow lint`: find duplicates, contradictions, and dead references.
2. `marrow verify`: let the skeptic attack open, model-proposed facts.
3. `marrow synthesize`: read the digest of what changed and what is drifting.
4. `marrow truth`: review the product truth brief and the backlog.
5. `marrow distill --pending`: drain any undistilled evidence.

A short session once a week keeps the graph trustworthy.

## marrow lint: the tidy-up that never tidies for you

```bash
marrow lint
```

Lint reads the whole graph and reports five kinds of issues:

- **Duplicate nodes**: two nodes of the same kind with the same normalized title.
- **Near-duplicate nodes**: pairs whose embeddings sit closer than the duplicate threshold (tunable with the `MARROW_DUP_DISTANCE` environment variable).
- **Contradictions**: pairs of decisions that conflict with each other.
- **Dead edges**: an edge whose endpoint no longer exists.
- **Instruction smells**: cited evidence spans that look like injected instructions ("ignore previous instructions", shell commands, role impersonation, exfiltration attempts).

What lint will never do: auto-delete a node, auto-merge a pair, or auto-resolve a contradiction. It is strictly read-only. When you agree a duplicate is real, you resolve it yourself, usually by answering the duplicate question with `marrow answer`, or by retracting the wrong node with `marrow retract <nodeId> --reason "..."`.

## marrow verify: the skeptic

```bash
marrow verify
```

Verify walks every open decision and goal whose confidence came from the model, rebuilds a fresh context from only that node's own evidence plus the decided facts, and tries to knock it down. Each node comes back `[survived]` or `[flagged: reasons]`. The flags:

- **single_source**: every provenance span cites the same evidence row. One meeting said it once; treat it gently.
- **weak_provenance**: the cited spans are too short to carry the claim, or the model's own confidence is low.
- **contradicts_decided**: the proposed decision appears to conflict with something a human already decided. Verify also raises a question asking which one holds.
- **instruction_smell**: a cited span looks like an injected instruction rather than a genuine statement.

Verify never changes a node's status. A flagged fact stays open; the flag is a signal for you, not a verdict. Survivors are simply facts the skeptic could not break this week.

## marrow synthesize: the digest

```bash
marrow synthesize
marrow synthesize --days 14
```

Synthesize writes nothing. It gives you a headline and a change report for a recent window (pass `--days` to widen it): what changed, what was newly decided, what became contested, which decided facts are going stale, what got replaced and why, how many questions are open, how many drift catches surfaced, and how big the undistilled backlog is. This is the page you skim before standup.

## marrow truth: the backlog and the stale facts

```bash
marrow truth
```

Truth is the standing product brief: decided goals and decisions, open proposed goals, contested facts, gaps, pending drift catches, connector health, the undistilled backlog, and a list of next actions. When decided facts age past the staleness window (a year by default, tunable with `MARROW_STALE_DAYS`), truth tells you to reverify them. Staleness is a flag, not a deletion; confidence is never decayed behind your back.

## marrow distill --pending: drain the backlog

```bash
marrow distill --pending
marrow distill --pending --limit 200
```

Evidence that arrived without a model configured, or from a source your `.marrow/policy.json` marks as no-distill, sits in the backlog as raw text. This command distills it in batches and reports how many were processed and how many remain. An empty backlog succeeds even without a model; a nonempty one needs `MARROW_API_KEY` (or `MARROW_PROVIDER` for a local model) set.

## Wiring it to cron: no daemon required

Every maintenance command is a one-shot process that connects to Postgres, does its work, and exits. So plain cron is the whole scheduler. A weekly crontab entry:

```cron
# Monday 07:00: drain, lint, verify, then mail yourself the digest
0 7 * * 1  cd /srv/marrow && marrow distill --pending && marrow lint && marrow verify && marrow synthesize | mail -s "marrow weekly" team@example.com
```

Make sure `DATABASE_URL` is available to the cron environment. The CLI also reads a `.env` file in the working directory when `DATABASE_URL` is not already set, which is often the simplest wiring. Add `--json` to any command if you would rather pipe structured output into your own tooling.

If you would rather schedule in CI, the repo ships a GitHub Actions template at `.github/workflows/maintenance.yml` that runs the same rhythm (`distill --pending`, `synthesize`, `lint`) on a weekly cron. It arrives dispatch-only; uncomment its cron line to turn the schedule on.

## marrow doctor: the health check

```bash
marrow doctor
marrow doctor --json
```

Doctor never throws. It prints one line per check (`DATABASE_URL`, Postgres reachability, schema state, and whether a distillation model is configured), with a remedy under anything failing, and exits with code 3 when any check is a hard error, so it drops cleanly into CI or a cron health probe. The failure-by-failure table is in [FAQ and troubleshooting](./faq-and-troubleshooting.md).

## Keep reading

- [How knowledge flows](./how-knowledge-flows.md): the full path from raw evidence to decided fact.
- [CLI reference](./cli-reference.md): every command and flag in one place.
- [Trust and safety](./trust-and-safety.md): scrubbing, injection smells, and why retraction is human-only.
