---
"@marrowhq/core": patch
---

Keyless search is semantic now: with no model key configured, createMarrow wires the zero-config in-process embedding model instead of silently returning empty results for natural-language queries. MARROW_LOCAL_EMBEDDINGS=0 opts out of the one-time model download and stays lexical-only. An embedder that cannot run (optional package missing, download offline, endpoint down) degrades search to lexical with a one-line stderr notice instead of failing.
