---
"@marrowhq/cli": patch
"@marrowhq/core": patch
---

CLI papercuts batch: `marrow <command> --help` now prints a focused card for that one command instead of the whole global help; `marrow graph` is a first-class terminal graph surface (the map with no id, a neighbor walk from one node with `--depth`); `runs --kind` rejects an unknown kind and names the valid set instead of silently returning nothing; a missing input file reports in product voice ("No file at ...") instead of a raw Node ENOENT; and `doctor` gains a Connector-secrets check plus MARROW_SECRET_KEY, EMBEDDING and API-key env documentation in the help.
