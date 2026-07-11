# Evaluating agent memory: the metrics and Marrow's numbers

Vendor benchmarks in the agent-memory space are untrustworthy by default:
vendor-authored, unreproducible, and focused on retrieval while the write side
(the side that actually fails) goes unmeasured. A public audit of one Mem0
deployment found 97.8 percent of 10,134 auto-captured memories were junk
(github.com/mem0ai/mem0/issues/4573). This page defines the metrics that
matter, says exactly which ones Marrow measures today, and gives the one
command that reproduces every number.

## Reproduce everything

```bash
marrow eval --all        # from the published CLI
pnpm benchmark           # from a clone; also writes benchmark/report.json
```

Both run in a disposable scratch schema on your Postgres and never touch your
real brain. CI regenerates the report on every commit and fails if a
deterministic number no longer matches the committed
[benchmark/report.json](../benchmark/report.json), so the published claims
cannot silently drift from the code.

## The eleven metrics

| Metric | What it reveals | Marrow today |
| --- | --- | --- |
| Write precision | Stored memories that deserved storing | measured, gated >= 0.8 |
| Write recall | Durable facts that were missed | measured, gated >= 0.8 |
| False-memory rate | Stored claims without verbatim support | measured, gated at exactly 0 |
| Duplicate rate | Re-ingesting the same room must not double the brain | measured; entities gate at 0, decisions and goals reported until their write-time guard ships |
| Current-state accuracy | The latest valid fact wins everywhere | measured, gated at 1.0 |
| Historical accuracy | What was true before stays reachable | measured, gated at 1.0 |
| Ingestion-ready latency | Time until a written fact is retrievable | measured (p95); distillation is synchronous, so a returned write is a readable write |
| Retrieval recall@k | The labeled relevant nodes are in the slice | measured, gated >= 0.9 |
| Context-noise ratio | Off-topic tokens riding along in the slice | measured, gated <= 0.5 (structural floor: 2 labeled nodes in a k=4 slice) |
| Prompt tokens per turn | What retrieval actually costs downstream | measured: flat-search ratio and prepare_task brief ratio, reported separately |
| Deletion completeness | Removal removes everything derived | defined, not yet measured; lands with the redaction command (roadmap R26), and raw evidence is append-only by design |

## How each number is produced

- **Write quality** drives the real pipeline (ingest, distill, verbatim-quote
  resolution, linkAndMerge) with model outputs recorded once, so the run is
  keyless and deterministic. It measures the pipeline's guards: a hallucinated
  quote is dropped, never stored; a restated entity merges; a tentative
  leaning lands as a question. What replay cannot see (a live model
  misbehaving on extraction) is the extraction policy's job and is not
  claimed here.
- **Temporal accuracy** resolves seeded conflicts through the same answer
  loop a human uses, then checks that `prepare_task` and search serve the
  winner while the superseded loser stays reachable with its content intact.
  Invalidation, not erasure.
- **Retrieval** runs on a labeled 12-doc synthetic corpus
  (`packages/core/fixtures/benchmark/`). Two ratios are reported separately
  and never blended: the flat task-scoped search (2.9x fewer tokens than a
  raw dump at recall 1.0) and the full `prepare_task` brief (1.5x; bigger
  because it carries decided truth, open questions, and provenance).
- **Drift catch** scores the code-vs-decision catch on a labeled golden set;
  the only real-usage number Marrow reports is the live catch precision from
  `marrow metrics`, computed from human accept and dismiss events (agent
  reactions are excluded from that label set).

## What is not claimed

- Every corpus here is synthetic and bundled; no partner or customer data is
  behind any number.
- The tokenizer is a stable chars-over-4 heuristic, chosen so ratios do not
  drift with a tokenizer library version. Absolute token counts are
  approximate; the ratios are the claim.
- The write-quality gates prove the deterministic pipeline, not live model
  extraction quality, which varies by provider and prompt.
- Keyword (keyless) search matches substrings, not paraphrases. The measured
  semantic numbers use the deterministic concept embedding; a real embedding
  model behaves at least as well on paraphrase but is not what CI measures.
