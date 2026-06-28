# Marrow vs Lore / Tenet

Lore and Tenet own the code layer. They parse the repo to build memory and answer questions about what exists. Marrow owns the room layer: what the team agreed before the code was written.

|  | Lore / Tenet | Marrow |
|---|---|---|
| Primary input | Code, git history | Transcripts, standups, interviews, notes |
| Truth model | The repo is the source of truth | The room is the source of truth; the repo is checked against it |
| Core loop | "What does this code do?" | "Does this code match what we decided?" |
| Drift model | Changes in code | Changes in code vs. decided product truth |
| Sacred guarantee | Code memory | Evidence is append-only; every fact has provenance |

We respect Lore and Tenet. We do not parse the repo as knowledge. Marrow is the layer that tells the coding agent what the product room decided, then checks the PR for contradictions.
