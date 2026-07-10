---
"@marrowhq/cli": minor
"@marrowhq/core": minor
"@marrowhq/mcp-server": minor
---

Fix the published first run and harden the developer experience.

- `marrow migrate` sets up or updates the schema, and `marrow demo` now migrates itself, so the advertised `npx @marrowhq/cli demo` works on a bare Postgres with no clone. The database error hints point at `marrow migrate` instead of pnpm-only scripts a published-bin user does not have.
- `marrow doctor` greenlights DATABASE_URL, Postgres reachability, schema, and model readiness in one command, with a remedy per failing check and a `--json` mode.
- CLI status color: decided is green, open yellow, contested red, superseded dim. Gated on a TTY and NO_COLOR so piped output and CI stay byte-clean.
- The MCP server reports its real package version instead of 0.0.0, ships agent instructions (decided vs open, propose not decide, trace before you build), and returns named validation errors instead of a raw zod blob.
- Help accuracy: `ingest` and `add` both note they distill by default, `add` honors `--no-distill`, `answer` documents `--decide`, and a breadcrumb points at the MCP server.
- Published package metadata: keywords, homepage, bugs, and author on all packages.
