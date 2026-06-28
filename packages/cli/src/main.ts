#!/usr/bin/env node
// Entry point for the `marrow` CLI. Help and version work with no database or
// providers; everything else builds a core from the environment, runs one
// command, and prints readable output (or raw JSON with --json). Published as
// the `marrow` bin (PR-19).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createMarrow } from "@marrowhq/core";

import { formatResult, HELP, runCommand } from "./cli.js";
import { runWebCommand } from "./web-command.js";

const here = dirname(fileURLToPath(import.meta.url));

/** `marrow demo`: the hero slice end to end with NO API key — a scripted model
 *  plus a deterministic in-process embedding, against the bundled interview. The
 *  60 second proof on a fresh install. Needs only Postgres (Marrow's one infra). */
async function runDemoCommand(): Promise<void> {
  const core = await import("@marrowhq/core");
  const store = core.createStore(process.env.DATABASE_URL);
  let brain: InstanceType<typeof core.Marrow> | undefined;
  try {
    brain = new core.Marrow(
      store,
      core.createDemoModel(),
      core.createDemoEmbedding(await store.embeddingProfile()),
    );
    const result = await core.runDemo(brain, core.DEMO_INTERVIEW);
    const d = result.decision;
    const span =
      result.trace.spans.find((s) => s.source.includes("design-partner")) ?? result.trace.spans[0];
    console.log(
      [
        "",
        "— Marrow demo: the room, distilled —",
        "",
        "1. Ingested an interview and distilled it (no API key: a scripted model",
        "   plus a local in-process embedding did the work)",
        "2. The loop raised a question; you, the human, answered it",
        `3. Decision  [${d.status}]  ${d.title}`,
        `   Confidence ${d.confidence.value} (${d.confidence.source})`,
        "4. It traces to the exact line in the room:",
        `   ${span?.source}`,
        `   "${span?.spanText}"`,
        `5. An agent asking about it gets ${result.answer.length} task-scoped result(s), each`,
        `   carrying status + provenance. Still open: ${result.openQuestions.length} question(s).`,
        "",
        "Explore it in the UI:   marrow web",
        "Ingest your own room:   marrow ingest ./meetings",
        "",
      ].join("\n"),
    );
  } finally {
    if (brain) await brain.close();
    else await store.close();
  }
}

function version(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // help and version must never require a database (the common first state).
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(version());
    return;
  }
  if (argv.length === 0 || argv[0] === "help" || argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return;
  }

  // the two special commands: `web` stays up (long-running), `demo` builds its
  // own keyless core. both sit outside the standard run-one-command-and-close path.
  if (argv[0] === "web") return runWebCommand(argv);
  if (argv[0] === "demo") return runDemoCommand();

  const json = argv.includes("--json");
  const core = createMarrow();
  try {
    const result = await runCommand(core, argv);
    console.log(json ? JSON.stringify(result, null, 2) : formatResult(result));
    if (
      result &&
      typeof result === "object" &&
      "driftCi" in result &&
      (result as { driftCi?: { hasDrift?: boolean } }).driftCi?.hasDrift
    ) {
      process.exitCode = 1;
    }
  } finally {
    await core.close();
  }
}

/** Pull a useful message + code out of an error. a refused pg connection is an
 *  error whose `.message` is empty and whose `.code` is `ECONNREFUSED`, so we
 *  cannot rely on the message text alone. */
function describeError(error: unknown): { message: string; code: string | undefined } {
  const err = error as { message?: string; code?: string; errors?: unknown[] };
  const code = typeof err.code === "string" ? err.code : undefined;
  let message = typeof err.message === "string" ? err.message : "";
  if (!message && Array.isArray(err.errors)) {
    const nested = err.errors.find((e): e is Error => e instanceof Error);
    message = nested?.message ?? "";
  }
  return { message, code };
}

main().catch((error: unknown) => {
  const { message, code } = describeError(error);
  // map the common failures to a one-line remedy and a distinct exit code, so a
  // human and an agent loop can tell a usage error from infra being down.
  let exitCode = 1;
  let text = message;
  let hint = "";
  const isConn =
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|getaddrinfo/i.test(message);
  const isSchema =
    code === "42P01" || /relation ".*" does not exist|column ".*" does not exist/i.test(message);
  if (isConn) {
    exitCode = 3;
    text = message || `Could not reach Postgres (${code ?? "connection refused"})`;
    hint =
      "\nIs Postgres reachable? Start it (`pnpm db:up`) and run `pnpm db:migrate`, or set DATABASE_URL.";
  } else if (isSchema) {
    exitCode = 3;
    hint = "\nThe schema is not migrated. Run `pnpm db:migrate`.";
  } else if (/DATABASE_URL is not set/i.test(message)) {
    exitCode = 3;
  } else if (
    /^usage:/i.test(message) ||
    /unknown command/i.test(message) ||
    /^invalid /i.test(message)
  ) {
    exitCode = 2;
  }
  console.error((text || String(error)) + hint);
  process.exit(exitCode);
});
