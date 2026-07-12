# How we measure memory

Every memory vendor says their product "remembers what matters." Marrow publishes numbers instead. This page lists the metrics we track, the values currently committed to the repo, and the machinery that keeps those values honest: a disposable scratch schema so evals never touch your real data, and a CI drift gate that fails the build if a published number stops matching the code. You can reproduce every number yourself with one command.

## Why numbers instead of adjectives

Adjectives cannot rot in a visible way. A number can. If we claim a false-memory rate of zero and the code regresses, the committed scorecard and the regenerated scorecard disagree, and CI fails. That is the whole design: make the claims cheap to check and expensive to fake.

The full argument, including why we think vendor benchmarks are generally untrustworthy and why the write side of memory usually goes unmeasured, lives in the methodology doc: [Evaluating agent memory](../evaluating-agent-memory.md).

## The metrics

Each metric gets a one-line definition and its current committed value from the scorecard.

**Write precision.** The fraction of stored memories that deserved storing. Gated at 0.8 or higher. Current: 1.0.

**Write recall.** The fraction of durable facts that were captured rather than missed. Gated at 0.8 or higher. Current: 1.0.

**False-memory rate.** Stored claims with no verbatim support in the source. Gated at exactly zero, because a memory system that invents facts is worse than no memory. Current: 0.

**Duplicate rate.** Re-ingesting the same room must not double the brain. Entities gate at zero; decisions and goals are reported but not gated until their write-time guard ships. Current: 0 overall, 0 for entities.

**Current-state accuracy.** The latest valid fact wins everywhere. Gated at 1.0. Current: 1.0.

**Historical accuracy.** What was true before stays reachable, because Marrow invalidates old facts instead of erasing them. Gated at 1.0. Current: 1.0.

**Ingestion-ready latency.** Time from write to retrievable, measured at p95. Distillation is synchronous, so a returned write is a readable write. Measured but not gated. Current: 11.88 ms p95.

**Retrieval recall@k.** Whether the labeled relevant nodes appear in the retrieved slice. Gated at 0.9 or higher. Current: 1.0 across all 12 benchmark questions.

**Context-noise ratio.** The share of off-topic tokens riding along in the slice. Gated at 0.5 or lower. Current: 0.48. Note the structural floor: with 2 labeled nodes in a slice of 4 results, roughly half the slice is unlabeled by construction.

**Prompt tokens per turn.** What retrieval costs downstream, expressed as a ratio against dumping the whole corpus. Flat search and the `prepare_task` brief are reported separately and never blended. Current: flat search averages 421 tokens, a 2.9x reduction against the 1209-token baseline. The `prepare_task` brief averages 790 tokens, a 1.5x reduction. The brief is bigger on purpose: it carries decided truth, open questions, and provenance, not just matching snippets.

**Deletion completeness.** Removal must remove everything derived. This one is defined but not yet measured, and we say so plainly. It lands with the planned human-only redaction command, which is not shipped yet because it visibly amends the append-only evidence rule. Raw evidence is append-only by design.

Two more numbers ride along in the scorecard: the drift catch eval against a labeled golden set (precision 1.0, recall 1.0, f1 1.0 over 3 cases) and per-question token, noise, and latency detail for all 12 benchmark questions.

## What the numbers are, and are not

The tokenizer is a chars-divided-by-4 heuristic. It is stable, so the ratios do not drift, but absolute token counts are approximate. The ratios are the claim.

The corpus is a labeled 12-document synthetic corpus that ships in the repo. No customer or partner data sits behind any published number. The write-quality eval replays recorded model outputs, so it is keyless and deterministic: it proves the pipeline's guards work, not the extraction quality of a live model. The only real-usage number Marrow reports is live catch precision from `marrow metrics`, computed from human accept and dismiss events, with agent reactions excluded.

One honest limit: keyword-only search matches substrings, not paraphrases. The semantic numbers use the deterministic concept embedding.

## The scratch-schema rule

The entire eval suite runs in a disposable scratch schema on your own Postgres and never touches your real brain. It is also keyless: no model API key is needed to run it. You can point it at the same database your team uses and nothing in your actual knowledge graph is read or written. When the run finishes, the scratch schema is disposable. This is why you can run the evals on day one, before you trust Marrow with anything.

## The drift gate

Published numbers rot in most projects because nothing checks them. Here, CI regenerates the scorecard into a temporary file on every pull request and diffs the deterministic fields against the committed scorecard at `benchmark/report.json`. If any public number no longer matches what the code produces, the build fails. The fix is to rerun the benchmark and commit the new numbers, which makes every metric change visible in review.

Latency and ingestion-ready fields are stripped before the comparison, because wall-clock timings vary from run to run and would make the gate flaky. Everything deterministic is compared exactly.

## Reproduce it yourself

From the published CLI, against your own Postgres:

```bash
marrow eval --all
```

From a clone of the repo, which also rewrites the committed scorecard:

```bash
pnpm benchmark
```

Both run in the disposable scratch schema described above. If your numbers disagree with ours, that is a bug report we want.

## Keep reading

- [Search and retrieval](./search-and-retrieval.md): what the recall and noise numbers are actually measuring.
- [Trust and safety](./trust-and-safety.md): the scrub, the policy layer, and the append-only evidence rule behind the deletion-completeness caveat.
- [Keeping the brain healthy](./maintenance.md): the maintenance loops that keep these numbers true in a long-lived brain.
