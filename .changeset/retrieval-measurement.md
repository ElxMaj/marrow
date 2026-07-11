---
"@marrowhq/core": minor
---

Measure what agents actually receive: recall, noise, and the brief ratio.

The public token ratio measured flat search only, on a 3-doc corpus, with no
relevance judgment: a ranking regression that returned wrong-but-small slices
would have kept it green. The benchmark corpus grows to 12 labeled docs, and
runBenchmark now scores recall@k (are the labeled relevant nodes in the
slice) and context-noise ratio (how many slice tokens are off-topic), plus a
prepare_task arm reporting the brief's tokens and ratio separately.

The regenerated numbers, published as measured: flat-search ratio 2.9x at
recall 1.0 (k=4, noise 0.48 with a structural floor of about half at two
labeled nodes per four slots), and the full prepare_task brief at 1.5x,
smaller than the old headline because the brief carries decided truth, open
questions, and provenance. Two separate honest numbers instead of one blended
claim, and the README now says exactly that.
