---
"@marrowhq/core": minor
---

Write-quality golden eval: measure the side of memory that actually fails.

The research's central lesson is that memory writing is harder than
retrieval (a public Mem0 audit found 97.8 percent of one deployment's
auto-captured memories were junk), and Marrow's write path had zero
measurement. runWriteEval drives the real pipeline (ingest, distill, span
resolution, linkAndMerge) with model outputs recorded once, so the run is
keyless and deterministic, and scores: write precision and recall against
labeled expectations, false-memory rate (gated at exactly zero, proving the
verbatim-quote drop guard), duplicate rate under re-ingestion (entities gate
at zero; decisions and goals are reported honestly until their write-time
guard lands), and ingestion-ready p95 (honest because distillation is
synchronous). The bundled golden set ships with the package and covers the
Mem0 junk classes: hallucinated quotes, near-duplicate restatement, and
tentative leanings stored as durable.
