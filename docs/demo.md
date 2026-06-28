# Marrow hero demo

The whole thing on one slice: an interview becomes a decided decision with provenance, served to a coding agent over MCP, traceable to the exact source line.

## Setup (from a clean clone)

```bash
pnpm install
pnpm db:up          # Postgres + pgvector via docker compose
pnpm db:migrate
pnpm demo           # runs the scripted slice end to end
```

`pnpm demo` ingests the interview fixture (`packages/core/fixtures/demo/pfc-gdynia.md`, recorded with the evidence source label `interviews/pfc-gdynia.md`), distills it, answers the loop's question, and prints the decided magic-link decision with its trace back to the interview. It distills deterministically so it runs with no API key; set `MARROW_PROVIDER` plus a key to run the same pipeline on real input.

## The 90 second script

1. The room. A front-desk interview: staff share one login, the password ends up on a post-it.
2. Distill. Marrow extracts an open decision (magic links, no shared passwords) and an open question (re-authentication cadence), each cited to an exact span in the interview. Nothing is decided yet.
3. The loop. Marrow surfaces the question. The developer answers "yes, magic links only". That is the only thing that promotes a node to decided.
4. Decided, with provenance. The decision is now decided, human confidence, and `trace_to_source` returns the exact interview line: "magic links, no shared passwords".
5. The agent. In Claude Code, ask "why magic link auth". Marrow returns the decided decision with its status and source over MCP, a few task-scoped tokens, not the whole room. The agent writes `sendMagicLink` and cites the interview line in a comment, traceable with `marrow trace`.
6. Still open. Re-authentication cadence stays open. The brain knows what it does not know.

## Connect a coding agent over MCP

Point your agent host at the Marrow MCP server over stdio. Use an ABSOLUTE path
to the server (a relative path only resolves when the host's cwd is the repo
root). The README "connect to Claude Code or Codex" section has the full
`claude mcp add` form; the raw config is:

```jsonc
{
  "mcpServers": {
    "marrow": {
      "command": "npx",
      "args": ["tsx", "/ABSOLUTE/PATH/TO/marrow/packages/mcp-server/src/main.ts"],
      "env": {
        "DATABASE_URL": "postgres://marrow:marrow@localhost:5432/marrow",
        "MARROW_PROVIDER": "claude",
        "MARROW_API_KEY": "sk-ant-...",
        "MARROW_EMBEDDING_BASE_URL": "http://localhost:11434/v1",
        "MARROW_EMBEDDING_MODEL": "nomic-embed-text"
      }
    }
  }
}
```

The agent then has `search`, `get_decisions`, `get_open_questions`, `get_entity`, `trace_to_source`, plus the shaped writes. Every result carries status and provenance, and no tool can set a node decided.

## Browse the brain

```bash
pnpm --filter web build
DATABASE_URL=postgres://marrow:marrow@localhost:5432/marrow pnpm --filter web start
# open http://localhost:8787 : decided vs open, click any node for its exact source span
```
