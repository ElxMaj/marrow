#!/usr/bin/env node
// Entry point for the `marrow` CLI. Help and version work with no database or
// providers; everything else builds a core from the environment, runs one
// command, and prints readable output (or raw JSON with --json). Published as
// the `marrow` bin (PR-19).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createMarrow, doctor, migrate } from "@marrowhq/core";

import { commandHelp, formatResult, HELP, runCommand } from "./cli.js";
import { colorStatus, dim } from "./color.js";
import { runWebCommand } from "./web-command.js";

const here = dirname(fileURLToPath(import.meta.url));

/** `marrow demo`: the hero slice end to end with NO API key, a scripted model
 *  plus a deterministic in-process embedding, against the bundled interview. The
 *  60 second proof on a fresh install. Needs only Postgres (Marrow's one infra). */
async function runDemoCommand(argv: string[] = []): Promise<void> {
  const core = await import("@marrowhq/core");
  const store = core.createStore(process.env.DATABASE_URL);
  // The demo is the fresh-install proof, so it sets up its own schema first.
  // migrate is idempotent, so re-running demo is safe and stays quiet when the
  // schema is already current.
  const migrated = await core.migrate(process.env.DATABASE_URL);
  if (migrated.applied.length > 0) console.log("Set up the schema for the demo.");
  // The demo writes fictional product facts and evidence is append-only:
  // there is no undo. It refuses a brain that holds anything real, and
  // refuses to duplicate itself, unless forced.
  if (!argv.includes("--force")) {
    const check = await core.checkDemoBrain(store);
    if (!check.ok) {
      await store.close();
      if (check.reason === "has-real-evidence") {
        console.error(
          `This brain already holds ${check.otherCount} piece(s) of real evidence, and the demo writes fictional product facts into append-only storage.\n` +
            `Point DATABASE_URL at a fresh database for the demo (e.g. createdb marrow_demo), or pass --force to write into this one anyway.`,
        );
      } else {
        console.error(
          "The demo already ran in this brain. Explore it with `marrow web` or `marrow truth`, run it again against a fresh database, or pass --force to append a duplicate run.",
        );
      }
      process.exitCode = 3;
      return;
    }
  }
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
        "Marrow demo: the room, distilled",
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

/** `marrow doctor`: greenlight the whole first-run stack in one command. Prints a
 *  colored checklist with a remedy per failing check, exits 3 on any error so an
 *  agent loop can gate on it. `--json` for the machine contract. */
async function runDoctorCommand(argv: string[]): Promise<void> {
  const checks = await doctor(process.env.DATABASE_URL);
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ checks }, null, 2));
  } else {
    for (const c of checks) {
      const remedy = c.remedy ? dim(`\n      ${c.remedy}`) : "";
      console.log(`  [${colorStatus(c.status)}] ${c.name}: ${c.detail}${remedy}`);
    }
  }
  if (checks.some((c) => c.status === "error")) process.exitCode = 3;
}

/** `marrow migrate`: bring the schema up to date against DATABASE_URL. Gives a
 *  published-bin user a self-contained setup path with no pnpm workspace. */
async function runMigrateCommand(): Promise<void> {
  const result = await migrate(process.env.DATABASE_URL);
  if (result.applied.length === 0) {
    console.log("Schema is up to date.");
    return;
  }
  for (const name of result.applied) console.log(`Applied ${name}`);
  console.log(`Schema ready: applied ${result.applied.length} migration(s).`);
}

/** `marrow watch`: like `web`, this is long-running. It must stay outside the
 *  run-and-close path: the folder watcher keeps ingesting after setup, so the
 *  core (and its Postgres pool) has to live until Ctrl+C, not be closed the
 *  moment `runCommand` returns. `runCommand`'s watch case wires the SIGINT and
 *  SIGTERM shutdown that closes the core; here we just print and stay resident. */
async function runWatchCommand(argv: string[]): Promise<void> {
  const core = createMarrow();
  const result = await runCommand(core, argv);
  console.log(JSON.stringify(result, null, 2));
  await new Promise<never>(() => {}); // stay up until the watch case's SIGINT handler exits
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

  // the reflex every dev tool trains: `cp .env.example .env`. Honor it, but
  // never override an already-set variable, and never fail on a missing or
  // malformed file (loadEnvFile throws on absence; older runtimes lack it).
  if (!process.env.DATABASE_URL) {
    try {
      process.loadEnvFile(join(process.cwd(), ".env"));
      if (process.env.DATABASE_URL) {
        console.error(dim("Loaded DATABASE_URL from .env"));
      }
    } catch {
      // no .env, unreadable, or unsupported runtime: the normal state.
    }
  }

  // help and version must never require a database (the common first state).
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(version());
    return;
  }
  // `marrow <command> --help` shows focused help for that one command; a bare
  // `--help`, `help`, or no args shows the global help.
  if (
    (argv.includes("--help") || argv.includes("-h")) &&
    argv[0] &&
    argv[0] !== "help" &&
    !argv[0].startsWith("-")
  ) {
    const focused = commandHelp(argv[0]);
    console.log(focused ?? HELP);
    return;
  }
  if (argv.length === 0 || argv[0] === "help" || argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return;
  }

  // the two special commands: `web` stays up (long-running), `demo` builds its
  // own keyless core. both sit outside the standard run-one-command-and-close path.
  if (argv[0] === "web") return runWebCommand(argv);
  if (argv[0] === "demo") return runDemoCommand(argv.slice(1));
  if (argv[0] === "migrate") return runMigrateCommand();
  if (argv[0] === "doctor") return runDoctorCommand(argv);
  if (argv[0] === "watch") return runWatchCommand(argv);

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
      "\nIs Postgres reachable? Start it, then run `marrow migrate` (or set DATABASE_URL). From a clone: `pnpm db:up && pnpm db:migrate`.";
  } else if (isSchema) {
    exitCode = 3;
    hint = "\nThe schema is not migrated. Run `marrow migrate`.";
  } else if (/DATABASE_URL is not set/i.test(message)) {
    exitCode = 3;
    hint =
      process.argv[2] === "demo"
        ? "\nPoint DATABASE_URL at your Postgres and re-run `marrow demo`; demo sets up its own schema. From a clone: `pnpm db:up`, then the URL in .env.example."
        : "\nPoint DATABASE_URL at your Postgres, then run `marrow migrate` (or `marrow doctor` to check the whole stack). From a clone: `pnpm db:up`, then the URL in .env.example.";
  } else if (code === "ENOENT" || /ENOENT|no such file or directory/i.test(message)) {
    // a missing input file in product voice, with the raw errno as a dim aside
    // instead of a bare Node stack.
    exitCode = 2;
    const path = (error as { path?: string }).path;
    text = path ? `No file at ${path}.` : "That file does not exist.";
    hint = "\nCheck the path, or pass a folder to ingest everything under it.";
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
