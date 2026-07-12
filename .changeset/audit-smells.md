---
"@marrowhq/core": minor
"@marrowhq/cli": patch
---

Poisoned evidence is caught in audits, not only at the moment of quoting.

marrow lint gains an instruction_smell issue kind: the scheduled sweep now
fetches each cited evidence row once (bounded and cached), runs the
instruction-smell detector over every cited span, and reports which
evidence looks instruction-shaped and which nodes cite it. The skeptic
gains the same axis: marrow verify flags an open model-proposed fact whose
cited span smells like instructions, alongside single-source and
weak-provenance. Both stay strictly advisory: lint reports and never
mutates, the skeptic records a verdict and never promotes.
