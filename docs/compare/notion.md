# Marrow vs Notion / Confluence

Notion and Confluence are general-purpose wikis. They are great for documentation; they are not designed to stop drift between the product room and the code.

|  | Notion / Confluence | Marrow |
|---|---|---|
| Source of truth | Hand-written pages | Distilled from raw evidence (transcripts, standups, notes) |
| Status | Static text | Every fact carries status (open / decided / contested / superseded) |
| Provenance | Author + last edit | Link to exact evidence span |
| Drift detection | Manual review | Automated `marrow drift` against git hunks |
| Agent context | Paste a page | Task-scoped retrieval that does not dump the whole wiki |

Use Notion for docs. Use Marrow for decisions that must hold while the codebase changes.
