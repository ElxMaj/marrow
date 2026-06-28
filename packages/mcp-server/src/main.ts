#!/usr/bin/env node
// Entry point: build a Marrow core from the environment and serve it over
// stdio. an agent host (Claude Code, Codex) spawns this and speaks MCP to it.
import { createMarrow } from "@marrowhq/core";

import { runStdio } from "./server.js";

async function main(): Promise<void> {
  await runStdio(createMarrow());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
