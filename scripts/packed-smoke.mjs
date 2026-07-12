#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packages = ["shared", "core", "web", "mcp-server", "cli"];
const adminUrl = process.env.MARROW_ADMIN_URL ?? "postgres://marrow:marrow@localhost:5432/postgres";

async function run(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: root,
      env: process.env,
      maxBuffer: 1024 * 1024 * 8,
      ...options,
    });
    return result.stdout.trim();
  } catch (error) {
    const stdout = error.stdout?.trim();
    const stderr = error.stderr?.trim();
    const detail = [stdout, stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
}

async function createDatabase(appDir, databaseName) {
  const pg = await import(pathToFileURL(join(appDir, "node_modules/pg/lib/index.js")).href);
  const pool = new pg.default.Pool({ connectionString: adminUrl });
  try {
    await pool.query(`create database ${databaseName}`);
  } finally {
    await pool.end();
  }
}

async function dropDatabase(appDir, databaseName) {
  try {
    const pg = await import(pathToFileURL(join(appDir, "node_modules/pg/lib/index.js")).href);
    const pool = new pg.default.Pool({ connectionString: adminUrl });
    try {
      await pool.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1",
        [databaseName],
      );
      await pool.query(`drop database if exists ${databaseName}`);
    } finally {
      await pool.end();
    }
  } catch {
    // Cleanup is best effort. The original test failure is more useful.
  }
}

async function seedAndCheckMcp(appDir, databaseUrl) {
  const seed = String.raw`
    import { Marrow, Store } from "@marrowhq/core";
    import { createTools } from "@marrowhq/mcp-server";

    const store = new Store(process.env.DATABASE_URL);
    const core = new Marrow(store);
    const human = { value: 1, source: "human" };
    const model = { value: 0.6, source: "model" };

    const auth = "Dana: We decided magic links, no passwords. Password login is explicitly out for launch.";
    const authEv = await store.insertEvidence({ text: auth, source: "interviews/auth.md" });
    const phrase = "magic links, no passwords";
    const start = auth.indexOf(phrase);
    const decision = await store.insertDecision({
      title: "Auth uses magic links, no passwords",
      rationale: "password login is out for launch",
      constraint: true,
      status: "decided",
      confidence: human,
      provenance: [{ evidenceId: authEv.id, start, end: start + phrase.length }],
    });
    await store.insertGoal({
      title: "Users sign in without password setup",
      goalType: "user",
      status: "decided",
      confidence: human,
      provenance: [{ evidenceId: authEv.id, start: 0, end: auth.length }],
    });
    await store.insertQuestion({
      prompt: "Do admins need a recovery path without passwords?",
      relatesTo: [decision.id],
      status: "open",
      confidence: model,
      provenance: [{ evidenceId: authEv.id, start: 0, end: 4 }],
    });

    const goalText = "Product goal: make onboarding self serve";
    const goalEv = await store.insertEvidence({ text: goalText, source: "standups/goals.md" });
    await store.insertGoal({
      title: "Make onboarding self serve",
      goalType: "product",
      status: "decided",
      confidence: human,
      provenance: [{ evidenceId: goalEv.id, start: 0, end: goalText.length }],
    });
    await store.insertGoal({
      title: "Offer passkeys someday",
      goalType: "user",
      status: "open",
      confidence: model,
      provenance: [{ evidenceId: goalEv.id, start: 0, end: 12 }],
    });
    await store.insertDecision({
      title: "Password login might return",
      rationale: "",
      constraint: false,
      status: "contested",
      confidence: model,
      provenance: [{ evidenceId: goalEv.id, start: 0, end: 12 }],
    });
    await store.insertQuestion({
      prompt: "goal gap: which feature serves the onboarding goal?",
      status: "open",
      confidence: model,
      provenance: [{ evidenceId: goalEv.id, start: 0, end: 12 }],
    });
    await core.driftScan(".", {
      hunks: [{
        path: "src/session.ts",
        lineStart: 8,
        lineEnd: 8,
        oldLines: "",
        newLines: "const passwordHash = hash(password);",
        hunkHeader: "@@ -0,0 +8,1 @@",
      }],
      semantic: false,
    });
    await core.upsertConnector({
      name: "slack",
      kind: "slack",
      enabled: true,
      settings: { channelIds: ["C1"] },
      secret: "xoxb-smoke-secret",
    });

    const tools = createTools(core);
    const names = tools.map((tool) => tool.name);
    if (!names.includes("prepare_task")) throw new Error("MCP missing prepare_task");
    if (!names.includes("maintain_truth")) throw new Error("MCP missing maintain_truth");
    const prepared = await tools.find((tool) => tool.name === "prepare_task").handler({
      task: "implement password login",
    });
    const maintained = await tools.find((tool) => tool.name === "maintain_truth").handler({});
    if (!JSON.stringify(prepared).includes("magic links, no passwords")) {
      throw new Error("prepare_task missed magic-link fact");
    }
    if (!JSON.stringify(maintained).includes("Offer passkeys someday")) {
      throw new Error("maintain_truth missed proposed goal");
    }
    await core.close();
  `;
  await run(process.execPath, ["--input-type=module", "-e", seed], {
    cwd: appDir,
    env: { ...process.env, DATABASE_URL: databaseUrl, MARROW_SECRET_KEY: "packed-smoke-secret" },
  });
}

async function runCliChecks(appDir, databaseUrl) {
  const marrow = join(appDir, "node_modules/.bin/marrow");
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    MARROW_SECRET_KEY: "packed-smoke-secret",
  };

  const loop = await run(marrow, ["loop", "implement password login"], { cwd: appDir, env });
  if (!loop.includes("Auth uses magic links, no passwords")) {
    throw new Error("packed CLI loop missed decided auth fact");
  }
  if (!loop.includes("Ask a human first")) {
    throw new Error("packed CLI loop did not render ask-human-first section");
  }

  const truth = await run(marrow, ["truth"], { cwd: appDir, env });
  if (!truth.includes("Offer passkeys someday")) {
    throw new Error("packed CLI truth missed open proposed goal");
  }
  if (!truth.includes("Connector health")) {
    throw new Error("packed CLI truth missed connector health");
  }

  // eval with no fixture must run the BUNDLED golden set from the packed
  // tarball: proves the fixture ships and the empty-run guard never fires.
  const evalOut = await run(marrow, ["eval"], { cwd: appDir, env });
  if (!/precision/i.test(evalOut)) {
    throw new Error("packed CLI eval did not print a scorecard");
  }
  // the golden set's case names must appear: a scorecard without cases is the
  // fake empty run this step exists to prevent.
  if (!evalOut.includes("auth magic links vs password")) {
    throw new Error("packed CLI eval did not run the bundled golden set");
  }

  const repoDir = await mkdtemp(join(tmpdir(), "marrow-packed-repo-"));
  try {
    await run("git", ["init", "-q"], { cwd: repoDir });
    await run("git", ["config", "user.email", "smoke@example.com"], { cwd: repoDir });
    await run("git", ["config", "user.name", "Smoke"], { cwd: repoDir });
    await writeFile(join(repoDir, "auth.ts"), 'export const mode = "magic-link";\n');
    await run("git", ["add", "auth.ts"], { cwd: repoDir });
    await run("git", ["commit", "-qm", "init"], { cwd: repoDir });
    await writeFile(
      join(repoDir, "auth.ts"),
      'export const mode = "magic-link";\nconst passwordHash = hash(password);\n',
    );
    const checked = await run(
      marrow,
      ["loop", "implement password login", "--check", "--unstaged", "--no-semantic"],
      { cwd: repoDir, env },
    );
    if (!checked.includes("Drift check")) throw new Error("packed CLI check missed drift section");
    if (!checked.includes("receipt: Auth uses magic links, no passwords")) {
      throw new Error("packed CLI check missed receipt data");
    }
    if (!checked.includes("marrow accept"))
      throw new Error("packed CLI check missed next commands");
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
}

async function main() {
  const packDir = await mkdtemp(join(tmpdir(), "marrow-packed-tarballs-"));
  const appDir = await mkdtemp(join(tmpdir(), "marrow-packed-app-"));
  const databaseName = `marrow_packed_smoke_${Date.now()}_${process.pid}`;
  const databaseUrl = `postgres://marrow:marrow@localhost:5432/${databaseName}`;

  try {
    console.log("packed-smoke: building workspace");
    await run("pnpm", ["-r", "build"]);

    console.log("packed-smoke: packing packages");
    for (const pkg of packages) {
      await run("pnpm", [
        "--dir",
        join(root, "packages", pkg),
        "pack",
        "--pack-destination",
        packDir,
      ]);
    }

    console.log("packed-smoke: installing tarballs in disposable app");
    await writeFile(join(appDir, "package.json"), '{"type":"module","private":true}\n');
    // Read each package's real version so `pnpm pack` output (marrowhq-<name>-
    // <version>.tgz) is matched exactly. Hardcoding the version breaks the smoke
    // test on every release bump.
    const tarballs = [];
    for (const pkg of packages) {
      const manifest = JSON.parse(
        await readFile(join(root, "packages", pkg, "package.json"), "utf8"),
      );
      tarballs.push(join(packDir, `marrowhq-${pkg}-${manifest.version}.tgz`));
    }
    await run("npm", ["install", "--omit=optional", "--ignore-scripts", ...tarballs], {
      cwd: appDir,
    });

    console.log("packed-smoke: creating disposable database");
    await createDatabase(appDir, databaseName);
    await run(process.execPath, ["node_modules/@marrowhq/core/scripts/migrate.mjs"], {
      cwd: appDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });

    console.log("packed-smoke: seeding truth and checking MCP tools");
    await seedAndCheckMcp(appDir, databaseUrl);

    console.log("packed-smoke: checking CLI loop, truth, and check mode");
    await runCliChecks(appDir, databaseUrl);

    console.log("packed-smoke: ok");
  } finally {
    await dropDatabase(appDir, databaseName);
    await rm(packDir, { recursive: true, force: true });
    await rm(appDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
