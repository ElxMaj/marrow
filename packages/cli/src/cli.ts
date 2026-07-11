import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type Distilled, type Marrow, type RunFilter, normalizeTranscript } from "@marrowhq/core";
import {
  type ConnectorSummary,
  type ConnectorSyncResult,
  type RunKind,
  type RunMetrics,
  type RunRecord,
  type Status,
} from "@marrowhq/shared";

import { colorStatus, dim } from "./color.js";
import { watchFolder } from "./watch.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Load the bundled benchmark corpus. It lives in the package's own benchmark/
 * dir (shipped via files:["dist","benchmark"]) and resolves relative to this
 * module, which sits one level under the package root in both src (dev) and
 * dist (published), so the same join works in both.
 */
export function loadBenchmarkCorpus(): import("@marrowhq/core").SeedDoc[] {
  return JSON.parse(
    readFileSync(join(here, "..", "benchmark", "corpus", "meetings.json"), "utf8"),
  ) as import("@marrowhq/core").SeedDoc[];
}

const STATUSES: readonly Status[] = ["open", "decided", "contested", "superseded"];
const isStatus = (value: string): value is Status => STATUSES.some((s) => s === value);

const flagValue = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
};
const VALUE_FLAGS = new Set([
  "--audio",
  "--confidence",
  "--days",
  "--debounce",
  "--decide",
  "--description",
  "--end",
  "--entity",
  "--evidence",
  "--image",
  "--kind",
  "--limit",
  "--name",
  "--reason",
  "--secret",
  "--settings",
  "--since",
  "--source",
  "--start",
  "--status",
  "--text",
  "--type",
  "--until",
]);
const positional = (args: string[]): string | undefined => {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (arg.startsWith("--")) {
      if (VALUE_FLAGS.has(arg)) i++;
      continue;
    }
    return arg;
  }
  return undefined;
};

// transcript file extensions we know how to ingest in a directory sweep.
const TRANSCRIPT_EXT = new Set([".vtt", ".srt", ".json", ".txt", ".md", ".markdown", ".text"]);

// files marrow import treats as seed docs / decision logs.
const IMPORT_DOC_EXT = new Set([".md", ".mdx", ".txt", ".markdown", ".text"]);

/** Resolve an ingest target to a concrete list of files: a single file stays a
 *  singleton; a directory is swept recursively for known transcript files, so
 *  `marrow ingest ./meetings` picks up a whole folder of exports at once. */
function collectTranscriptFiles(target: string): string[] {
  const stat = statSync(target);
  if (stat.isFile()) return [target];
  const out: string[] = [];
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const full = join(target, entry.name);
    if (entry.isDirectory()) out.push(...collectTranscriptFiles(full));
    else if (entry.isFile() && TRANSCRIPT_EXT.has(extname(entry.name).toLowerCase()))
      out.push(full);
  }
  return out.sort();
}

/** Collect markdown/text/doc files for `marrow import`. */
function collectImportFiles(target: string): string[] {
  const stat = statSync(target);
  if (stat.isFile()) return [target];
  const out: string[] = [];
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const full = join(target, entry.name);
    if (entry.isDirectory()) out.push(...collectImportFiles(full));
    else if (entry.isFile() && IMPORT_DOC_EXT.has(extname(entry.name).toLowerCase()))
      out.push(full);
  }
  return out.sort();
}

async function importPath(
  core: Marrow,
  target: string,
  distill: boolean,
): Promise<{ imported: IngestSummary[] }> {
  const files = collectImportFiles(target);
  if (files.length === 0) throw new Error(`no markdown or text files found at ${target}`);
  const imported: IngestSummary[] = [];
  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    const basename = file.split(/[/\\]/).pop() ?? file;
    const source = ["CLAUDE.md", "DECISIONS.md", "AGENTS.md"].includes(basename)
      ? `repo:docs/${basename}`
      : `import:${file}`;
    imported.push(await ingestText(core, raw, source, file, distill));
  }
  return { imported };
}

const AUDIO_MEDIA: Record<string, string> = {
  ".m4a": "audio/m4a",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".webm": "audio/webm",
  ".flac": "audio/flac",
  ".mp4": "audio/mp4",
};
const IMAGE_MEDIA: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const mediaType = (file: string, table: Record<string, string>, fallback: string): string =>
  table[extname(file).toLowerCase()] ?? fallback;

interface IngestSummary {
  source: string;
  evidenceId: string;
  distilled: boolean;
  format?: string;
  speakers?: string[];
  turns?: number;
  nodes?: Distilled[];
}

/** Ingest one already-loaded text body: normalize it (any transcript format to
 *  clean speaker-attributed evidence) and distill when a model is configured. */
async function ingestText(
  core: Marrow,
  raw: string,
  source: string,
  filename: string | undefined,
  distill: boolean,
): Promise<IngestSummary> {
  const norm = normalizeTranscript(raw, filename !== undefined ? { filename } : {});
  const base = { source, format: norm.format, speakers: norm.speakers, turns: norm.turns };
  if (distill && core.canDistill) {
    const { evidenceId, nodes } = await core.ingestAndDistill({ text: norm.text, source });
    return { ...base, evidenceId, nodes, distilled: true };
  }
  return { ...base, evidenceId: await core.ingest({ text: norm.text, source }), distilled: false };
}

/** Distill an evidence row already stored (used after audio/image ingestion,
 *  which stores the transcribed/described text first). */
async function distillEvidence(
  core: Marrow,
  evidenceId: string,
  source: string,
  distill: boolean,
): Promise<IngestSummary> {
  if (distill && core.canDistill) {
    await core.distill(evidenceId);
    await core.linkAndMerge(evidenceId);
    return {
      source,
      evidenceId,
      distilled: true,
      nodes: await core.getNodesForEvidence(evidenceId),
    };
  }
  return { source, evidenceId, distilled: false };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export const HELP = `Marrow: the product context layer for coding agents

Usage: marrow <command> [args] [--json]

Try it (no API key needed):
  migrate                     Set up or update the schema on your Postgres
  doctor [--json]             Check DATABASE_URL, Postgres, schema, and model
  demo                        Run the hero slice end to end and explain it
  web [--open] [--port N]     Open the question-loop UI in your browser

Read the room (task-scoped; every result carries status + provenance):
  ask <query>                 Semantic search across the brain
  decisions [--status S]      List decisions (S: open|decided|contested|superseded)
  goals [--status S] [--type product|user]   List goals, decided vs open
  questions                   Open questions, most consequential first
  entity <idOrName>           One entity with its status and provenance
  trace <nodeId>              The exact source span(s) a fact came from
  neighbors <id> [--hops N]   Nodes linked to this one in the knowledge graph
  map [--limit N]             The front door: every node, most connected first

Add to the room (transcripts in many formats: vtt, srt, json, txt, md):
  ingest <path> [--source S]  Ingest a file, a whole folder, or stdin (distills by default)
  ingest --audio <file>       Transcribe a voice memo into evidence (needs a provider)
  ingest --image <file>       Read a whiteboard photo into evidence (needs a provider)
  watch <folder>              Continuously ingest new/changed files in a folder
  import <path>               Import markdown docs and decision logs as evidence
  add [file] [--source S]     Shorthand to ingest one file or stdin (distills by default)
  distill <evidenceId>        Distill an evidence row already ingested
  answer <questionId> --text "..." [--decide <id>]   The human promote-to-decided step
  goal author "<title>" [--type product|user] [--description "..."] [--entity <id>]
                              Author a decided goal (the human commitment path)
  goal propose "<title>" --type product|user --evidence <id> [--start N --end N]
                              Propose an open goal from evidence (the agent path;
                              promotion still goes through the answer loop)

Bootstrap / maintain:
  loop "<task>" [--check] [--staged|--unstaged|--since <ref>] [--no-semantic]
                              Prepare a compact agent brief for one task
  truth                       Show the product truth maintenance brief
  verify                      Attack proposed facts: flag single-source, weak, or contradicting ones
  lint                        Sweep the graph for duplicates, contradictions, and dead edges
  synthesize [--days N]       What changed and what deserves attention over a window (default 7d)
  init [repoPath]             One-time repo onboarding scan (asks, never asserts)
  drift [repoPath] [--staged|--unstaged|--since <ref>] [--no-semantic] [--ci]
                              Flag code that diverged from a decided fact
  dismiss <questionId> --reason "..."   Mark a catch as noise
  accept <questionId> --text "..."      Record that you acted on a catch
  metrics [--since ISO] [--until ISO] [--include-synthetic]
                              Catch precision and dismiss rate from events
  eval [fixture-path]         Run the golden-set eval harness
  benchmark                   Run the token-reduction benchmark

Connectors and automatic data flow (evidence is append only, only ever inserted):
  connectors                  List configured connectors and their sync state
  connectors add <kind> --name <n> --secret <s> [--settings '<json>']
                              Configure a connector. The secret is encrypted at rest.
                              Kinds: slack, github, linear, notion, figma, zoom,
                              intercom, email, teams, jira, granola, otter
  connectors enable|disable <name>   Turn a connector on or off
  connectors rm <name>        Remove a connector (its evidence stays)
  sync [name]                 Pull new evidence now (one connector, or all enabled)

Observability (every distill, search, drift and sync is recorded):
  runs [--kind K] [--status ok|error] [--limit N]   Recent pipeline runs
  observe [--since ISO] [--until ISO]   Cost, latency, tokens, errors, by kind

Serve a coding agent over MCP (the CLI and MCP server are equals):
  See @marrowhq/mcp-server, e.g. claude mcp add marrow -- npx -y @marrowhq/mcp-server

Global flags:
  --json                      Print raw JSON instead of formatted text
  --no-distill                Ingest only, do not distill
  -h, --help                  Show this help
  -v, --version               Show the version

Examples:
  marrow demo
  marrow ingest ./meetings --source standups
  cat zoom-call.vtt | marrow ingest -
  marrow answer q_123 --text "soft delete, 30 day window, then purge"

Embeddings are zero-config (a local model runs in-process); distillation needs a
model (set MARROW_API_KEY for Claude, or MARROW_PROVIDER for a local LLM). Reads
and ingestion work without a model.`;

/**
 * Run one CLI command against core and return its structured result. The CLI is
 * a thin client: it only ever calls core, so it can never set decided directly.
 * `answer` promotes through the core promote path, like the web view.
 */
export async function runCommand(core: Marrow, argv: string[]): Promise<unknown> {
  const [command, ...rest] = argv;
  switch (command) {
    case "ask":
      return { results: await core.search(rest.filter((a) => !a.startsWith("--")).join(" ")) };

    case "decisions": {
      const status = flagValue(rest, "--status");
      if (status !== undefined && !isStatus(status)) {
        throw new Error(`Invalid --status; one of ${STATUSES.join(", ")}`);
      }
      return { decisions: await core.getDecisions(status !== undefined ? { status } : {}) };
    }

    case "questions":
      return { questions: await core.getOpenQuestions() };

    case "goals": {
      const status = flagValue(rest, "--status");
      const type = flagValue(rest, "--type");
      if (status !== undefined && !isStatus(status)) {
        throw new Error(`Invalid --status; one of ${STATUSES.join(", ")}`);
      }
      if (type !== undefined && type !== "product" && type !== "user") {
        throw new Error("Invalid --type; one of product, user");
      }
      const filter: { status?: Status; goalType?: "product" | "user" } = {};
      if (status !== undefined) filter.status = status;
      if (type !== undefined) filter.goalType = type;
      return { goals: await core.getGoals(filter) };
    }

    // a goal is the only node a human authors decided directly (`goal author`),
    // because a goal is a commitment the room states rather than a fact distilled
    // from it. an agent can only `goal propose` (open, model, provenance-bound);
    // promotion of a proposed goal still goes through the `answer` loop.
    case "goal": {
      const sub = positional(rest);
      const afterSub = sub !== undefined ? rest.slice(rest.indexOf(sub) + 1) : [];
      const type = flagValue(rest, "--type") ?? "product";
      if (type !== "product" && type !== "user") {
        throw new Error("Invalid --type; one of product, user");
      }
      const description = flagValue(rest, "--description");
      const entityId = flagValue(rest, "--entity");

      if (sub === "author") {
        const title = positional(afterSub);
        if (!title) {
          throw new Error(
            'Usage: marrow goal author "<title>" [--type product|user] [--description "..."] [--entity <id>]',
          );
        }
        return {
          goal: await core.authorGoal({
            title,
            goalType: type,
            ...(description !== undefined ? { description } : {}),
            ...(entityId !== undefined ? { entityId } : {}),
          }),
        };
      }

      if (sub === "propose") {
        const title = positional(afterSub);
        if (!title) {
          throw new Error(
            'Usage: marrow goal propose "<title>" [--type product|user] --evidence <id> [--start N] [--end N] [--description "..."] [--entity <id>] [--confidence C]',
          );
        }
        const evidenceId = flagValue(rest, "--evidence");
        if (!evidenceId) {
          throw new Error(
            "Goal propose needs provenance: --evidence <id> [--start N] [--end N]. An agent may only propose an open goal pointing at a span.",
          );
        }
        const start = Number(flagValue(rest, "--start") ?? "0");
        const end = Number(flagValue(rest, "--end") ?? String(start));
        const confidence = flagValue(rest, "--confidence");
        return {
          goal: await core.proposeNode({
            kind: "goal",
            title,
            goalType: type,
            provenance: [{ evidenceId, start, end }],
            ...(description !== undefined ? { description } : {}),
            ...(entityId !== undefined ? { entityId } : {}),
            ...(confidence !== undefined ? { confidence: Number(confidence) } : {}),
          }),
        };
      }

      throw new Error('Unknown goal subcommand. Try: marrow goal author|propose "<title>"');
    }

    case "entity": {
      const idOrName = positional(rest);
      if (!idOrName) throw new Error("Usage: marrow entity <idOrName>");
      return { entity: (await core.getEntity(idOrName)) ?? null, query: idOrName };
    }

    case "trace": {
      const nodeId = positional(rest);
      if (!nodeId) throw new Error("Usage: marrow trace <nodeId>");
      return core.traceToSource(nodeId);
    }

    case "neighbors": {
      const nodeId = positional(rest);
      if (!nodeId) throw new Error("Usage: marrow neighbors <nodeId> [--hops 1|2]");
      const hopsRaw = flagValue(rest, "--hops");
      return core.getNeighbors(nodeId, hopsRaw ? Number(hopsRaw) : 1);
    }

    case "map": {
      const limitRaw = flagValue(rest, "--limit");
      return { index: await core.getIndex(limitRaw ? Number(limitRaw) : 200) };
    }

    case "loop": {
      const task = positional(rest);
      if (!task) throw new Error('Usage: marrow loop "<task>" [--check]');
      const since = flagValue(rest, "--since");
      const staged = rest.includes("--staged");
      const unstaged = rest.includes("--unstaged");
      const noSemantic = rest.includes("--no-semantic");
      let scope: "unstaged" | "staged" | string = "unstaged";
      if (since) scope = since;
      else if (staged) scope = "staged";
      else if (unstaged) scope = "unstaged";
      return core.prepareTask(task, {
        check: rest.includes("--check"),
        repoPath: process.cwd(),
        scope,
        semantic: !noSemantic,
      });
    }

    case "truth":
      return core.maintainTruth();

    case "verify":
      return core.verify();

    case "lint":
      return core.lint();

    case "synthesize": {
      const daysRaw = flagValue(rest, "--days");
      return core.synthesize(daysRaw ? Number(daysRaw) : 7);
    }

    case "add": {
      const file = positional(rest);
      const source = flagValue(rest, "--source") ?? file ?? "cli";
      const raw = file && file !== "-" ? readFileSync(file, "utf8") : await readStdin();
      // format-aware: a pasted Zoom/Otter/VTT transcript is normalized to clean
      // speaker-attributed text before it becomes evidence. distills by default
      // (so `add` then `questions` shows something); --no-distill stores only,
      // the same as ingest, so the flag is never silently dropped.
      const distill = !rest.includes("--no-distill");
      return ingestText(core, raw, source, file && file !== "-" ? file : undefined, distill);
    }

    case "ingest": {
      const audio = flagValue(rest, "--audio");
      const image = flagValue(rest, "--image");
      const distill = !rest.includes("--no-distill");
      const sourceOverride = flagValue(rest, "--source");

      // audio / image route through the optional transcription / vision
      // providers (a voice memo or a whiteboard photo becomes evidence text).
      if (audio !== undefined) {
        const source = sourceOverride ?? audio;
        const id = await core.ingestAudio(
          new Uint8Array(readFileSync(audio)),
          source,
          mediaType(audio, AUDIO_MEDIA, "audio/m4a"),
        );
        return { ingested: [await distillEvidence(core, id, source, distill)] };
      }
      if (image !== undefined) {
        const source = sourceOverride ?? image;
        const id = await core.ingestImage(
          new Uint8Array(readFileSync(image)),
          source,
          mediaType(image, IMAGE_MEDIA, "image/png"),
        );
        return { ingested: [await distillEvidence(core, id, source, distill)] };
      }

      // a file, a whole directory (swept recursively), or stdin, any format.
      const target = positional(rest);
      if (target !== undefined && target !== "-") {
        const files = collectTranscriptFiles(target);
        if (files.length === 0) throw new Error(`No transcript files found at ${target}`);
        const ingested: IngestSummary[] = [];
        for (const f of files) {
          ingested.push(
            await ingestText(core, readFileSync(f, "utf8"), sourceOverride ?? f, f, distill),
          );
        }
        return { ingested };
      }
      const raw = await readStdin();
      return {
        ingested: [await ingestText(core, raw, sourceOverride ?? "stdin", undefined, distill)],
      };
    }

    case "watch": {
      const folder = positional(rest);
      if (!folder) throw new Error("Usage: marrow watch <folder>");
      const distill = !rest.includes("--no-distill");
      const debounceMs = Number(flagValue(rest, "--debounce") ?? "2000");
      const watcher = await watchFolder({ folder, core, distill, debounceMs });
      const stop = (): void => {
        watcher.close();
        void core.close().finally(() => process.exit(0));
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      return { watching: folder, debounceMs, distill };
    }

    case "import": {
      const target = positional(rest);
      if (!target) throw new Error("Usage: marrow import <file|folder>");
      const distill = !rest.includes("--no-distill");
      return importPath(core, target, distill);
    }

    case "distill": {
      const evidenceId = positional(rest);
      if (!evidenceId) throw new Error("Usage: marrow distill <evidenceId>");
      await core.distill(evidenceId);
      await core.linkAndMerge(evidenceId);
      return { evidenceId, nodes: await core.getNodesForEvidence(evidenceId) };
    }

    case "answer": {
      const id = positional(rest);
      const text = flagValue(rest, "--text");
      const decide = flagValue(rest, "--decide");
      if (!id || text === undefined) {
        throw new Error(
          'Usage: marrow answer <questionId> --text "your answer" [--decide <decisionId>]',
        );
      }
      return core.answer(id, text, decide !== undefined ? { decide } : {});
    }

    case "init": {
      const repoPath = positional(rest) ?? process.cwd();
      return core.onboardingScan(repoPath);
    }

    case "drift": {
      const since = flagValue(rest, "--since");
      const staged = rest.includes("--staged");
      const unstaged = rest.includes("--unstaged");
      const noSemantic = rest.includes("--no-semantic");
      const ci = rest.includes("--ci");
      const positionalArg = positional(rest);
      const repoPath = positionalArg ?? process.cwd();
      let scope: "unstaged" | "staged" | string = "unstaged";
      if (since) scope = since;
      else if (staged) scope = "staged";
      else if (unstaged) scope = "unstaged";
      const result = await core.driftScan(repoPath, {
        scope,
        semantic: !noSemantic,
        trigger: ci ? "ci" : "cli",
      });
      if (ci) {
        const annotations = result.created
          .filter((n): n is import("@marrowhq/shared").Question => n.kind === "question")
          .map((q) => {
            const match = /^(.*):(\d+)-(\d+)/.exec(q.prompt);
            const file = match?.[1] ?? "";
            const line = match?.[2] ?? "1";
            return `::error file=${file},line=${line}::${q.prompt.replace(/\n/g, " ")}`;
          });
        return { driftCi: { annotations, hasDrift: annotations.length > 0 } };
      }
      return result;
    }

    case "dismiss": {
      const id = positional(rest);
      const reason = flagValue(rest, "--reason");
      if (!id || reason === undefined) {
        throw new Error('Usage: marrow dismiss <questionId> --reason "it is not a contradiction"');
      }
      return core.dismissCatch(id, reason);
    }

    case "accept": {
      const id = positional(rest);
      const text = flagValue(rest, "--text");
      if (!id || text === undefined) {
        throw new Error('Usage: marrow accept <questionId> --text "what you did about the drift"');
      }
      return core.acceptCatch(id, text);
    }

    case "metrics": {
      const since = flagValue(rest, "--since");
      const until = flagValue(rest, "--until");
      const includeSynthetic = rest.includes("--include-synthetic");
      return core.catchMetrics({ since, until, includeSynthetic });
    }

    case "eval": {
      const { runEval } = await import("@marrowhq/core");
      const fixture = positional(rest);
      const cases = fixture
        ? (JSON.parse(readFileSync(fixture, "utf8")) as import("@marrowhq/core").EvalCase[])
        : undefined;
      const report = await runEval(core, cases ?? []);
      return report;
    }

    case "benchmark": {
      const { runBenchmark, seedBenchmarkBrain } = await import("@marrowhq/core");
      const corpus = loadBenchmarkCorpus();
      await seedBenchmarkBrain(core, corpus);
      const report = await runBenchmark(core, {
        corpusTexts: corpus.map((d) => d.text),
        questions: [
          "What did we decide about onboarding?",
          "How do users authenticate?",
          "What payment gateway do we use?",
          "How long does async export poll?",
          "How do we catch contradictions in code?",
        ],
      });
      return report;
    }

    case "connectors": {
      const sub = positional(rest);
      if (sub === undefined) return { connectors: await core.listConnectors() };
      const afterSub = rest.slice(rest.indexOf(sub) + 1);
      if (sub === "add") {
        const kind = positional(afterSub);
        if (!kind) {
          throw new Error(
            "Usage: marrow connectors add <kind> --name <name> --secret <secret> [--settings '<json>'] [--no-enable]",
          );
        }
        const name = flagValue(rest, "--name") ?? kind;
        const secret = flagValue(rest, "--secret");
        const settingsRaw = flagValue(rest, "--settings");
        const settings = settingsRaw ? (JSON.parse(settingsRaw) as Record<string, unknown>) : {};
        const enabled = !rest.includes("--no-enable");
        const connector = await core.upsertConnector({
          name,
          kind,
          enabled,
          settings,
          ...(secret !== undefined ? { secret } : {}),
        });
        return { connector };
      }
      if (sub === "enable" || sub === "disable") {
        const name = positional(afterSub);
        if (!name) throw new Error(`Usage: marrow connectors ${sub} <name>`);
        await core.setConnectorEnabled(name, sub === "enable");
        return { connectorEnabled: { name, enabled: sub === "enable" } };
      }
      if (sub === "rm" || sub === "remove") {
        const name = positional(afterSub);
        if (!name) throw new Error(`Usage: marrow connectors rm <name>`);
        await core.deleteConnector(name);
        return { connectorRemoved: name };
      }
      throw new Error(
        `Unknown connectors subcommand "${sub}". Try: list (default), add, enable, disable, rm`,
      );
    }

    case "sync": {
      const name = positional(rest);
      if (name) return { synced: [await core.syncConnector(name)] };
      return { synced: await core.syncAllConnectors() };
    }

    case "runs": {
      const kind = flagValue(rest, "--kind");
      const status = flagValue(rest, "--status");
      const limit = flagValue(rest, "--limit");
      const filter: RunFilter = {};
      if (kind !== undefined) filter.kind = kind as RunKind;
      if (status === "ok" || status === "error") filter.status = status;
      if (limit !== undefined) filter.limit = Number(limit);
      return { runs: await core.getRuns(filter) };
    }

    case "observe": {
      const since = flagValue(rest, "--since");
      const until = flagValue(rest, "--until");
      return core.getRunMetrics({
        ...(since !== undefined ? { since } : {}),
        ...(until !== undefined ? { until } : {}),
      });
    }

    default:
      throw new Error(
        `Unknown command "${command ?? ""}". Run \`marrow --help\` for the commands.`,
      );
  }
}

// --- human-readable output ------------------------------------------------

const isNode = (value: unknown): value is Distilled =>
  typeof value === "object" && value !== null && "kind" in value && "status" in value;

const asNodes = (value: unknown): Distilled[] => (Array.isArray(value) ? value.filter(isNode) : []);

function nodeTitle(node: Distilled): string {
  if (node.kind === "entity") return node.name;
  if (node.kind === "decision") return node.title;
  if (node.kind === "goal") return node.title;
  return node.prompt;
}

function formatNode(node: Distilled): string {
  const spans = node.provenance.length;
  const c = node.confidence;
  // a goal carries its type (product vs user) in the label; everything else
  // keeps the bare kind. status and provenance always show, per provenance-required.
  const label = node.kind === "goal" ? `goal (${node.goalType})` : node.kind;
  // the status pops, the confidence/provenance metadata recedes into dim, so a
  // list of decisions reads as decided-vs-open at a glance. a verified date shows
  // when a human stood behind the fact (comma-free to keep the em-dash guard happy).
  const verified = node.verifiedAt ? ` · verified ${relTime(node.verifiedAt)}` : "";
  return `  [${colorStatus(node.status)}] ${label}: ${nodeTitle(node)}\n      ${dim(`${c.value} ${c.source} · ${spans} source span${spans === 1 ? "" : "s"}${verified} · ${node.id}`)}`;
}

function relTime(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function formatConnector(c: ConnectorSummary): string {
  const st = c.state;
  const status = st ? st.lastStatus : "Never synced";
  const last = st?.lastRunAt ? ` · ${relTime(st.lastRunAt)}` : "";
  const items = st ? ` · ${st.totalItems} items` : "";
  const err = st?.lastError ? `\n      Last error: ${st.lastError}` : "";
  return `  ${c.enabled ? "[on] " : "[off]"} ${c.name} (${c.kind}) · ${status}${last}${items}${err}`;
}

function formatRun(run: RunRecord): string {
  const cost = run.costUsd !== undefined ? ` · $${run.costUsd.toFixed(4)}` : "";
  const toks = run.tokensIn !== undefined ? ` · ${run.tokensIn}+${run.tokensOut ?? 0} tok` : "";
  const model = run.model ? ` · ${run.model}` : "";
  const label = run.label ? ` ${run.label}` : "";
  return `  [${colorStatus(run.status)}] ${run.kind}${label} · ${Math.round(run.latencyMs)}ms${toks}${cost}${model}`;
}

function formatBriefNode(node: {
  title: string;
  kind: string;
  status: string;
  stale?: boolean;
  provenance?: { source: string; spanText: string; createdAt?: string }[];
}): string {
  const span = node.provenance?.[0];
  const date = span?.createdAt ? ` · ${relTime(span.createdAt)}` : "";
  const source = span ? dim(`\n      Source: ${span.source}${date}\n      "${span.spanText}"`) : "";
  const stale = node.stale ? dim(" · stale, reverify") : "";
  return `  [${colorStatus(node.status)}] ${node.kind}: ${node.title}${stale}${source}`;
}

/** Render one ingested source: where it came from, the detected format and
 *  speakers, and what (if anything) distillation produced. shared by `add`
 *  (one source) and `ingest` (a file, a folder, or audio/image). */
function formatIngestSummary(s: Record<string, unknown>): string {
  const id = String(s.evidenceId);
  const src = typeof s.source === "string" ? s.source : id;
  const fmt = typeof s.format === "string" && s.format !== "text" ? ` [${s.format}]` : "";
  const speakerList = Array.isArray(s.speakers)
    ? s.speakers.filter((x) => typeof x === "string")
    : [];
  const speakers = speakerList.length > 0 ? ` · ${speakerList.length} speaker(s)` : "";
  const head = `Ingested ${src}${fmt}${speakers} → ${id}`;
  if (s.distilled === false) {
    return `${head}\n  Evidence stored. Set MARROW_API_KEY (Claude) or MARROW_PROVIDER (a local LLM) to distill, then \`marrow distill ${id}\`.`;
  }
  const nodes = asNodes(s.nodes);
  if (nodes.length === 0)
    return `${head}\n  Distilled, no new nodes yet (the room may not have decided anything).`;
  return `${head}\n  Distilled ${nodes.length} node(s):\n${nodes.map(formatNode).join("\n")}`;
}

/** Plain, readable output. Every node shows its status and provenance count, and
 *  the signature actions (answer, add) confirm what changed instead of dumping
 *  raw JSON. Pass --json for the machine contract. */
export function formatResult(result: unknown): string {
  if (!result || typeof result !== "object") return JSON.stringify(result, null, 2);
  const r = result as Record<string, unknown>;

  // task brief: compact safe-to-build vs ask-human-first sections.
  if ("safeToBuild" in r && "askHumanFirst" in r) {
    const brief = r as {
      task: string;
      status: string;
      safeToBuild: { facts: Parameters<typeof formatBriefNode>[0][] };
      askHumanFirst: {
        questions: Parameters<typeof formatBriefNode>[0][];
        contestedFacts?: Parameters<typeof formatBriefNode>[0][];
      };
      check?: {
        createdDriftQuestions: Parameters<typeof formatBriefNode>[0][];
        catchEventIds: number[];
        receiptData: {
          decisionTitle: string;
          path?: string;
          lineStart?: number;
          lineEnd?: number;
          sourceLabel: string;
        }[];
        nextCommands: { accept: string; dismiss: string }[];
      };
    };
    const safe =
      brief.safeToBuild.facts.length === 0
        ? "  (No decided task facts found.)"
        : brief.safeToBuild.facts.map(formatBriefNode).join("\n");
    const questions = brief.askHumanFirst.questions ?? [];
    const contested = brief.askHumanFirst.contestedFacts ?? [];
    const askItems = [...questions, ...contested];
    const ask =
      askItems.length === 0
        ? "  (No open or contested task questions.)"
        : askItems.map(formatBriefNode).join("\n");
    const lines = [
      `Task brief: ${brief.task}`,
      `Status: ${brief.status}`,
      "",
      "Safe to build",
      safe,
      "",
      "Ask a human first",
      ask,
    ];
    if (brief.check) {
      lines.push("", "Drift check");
      if (brief.check.createdDriftQuestions.length === 0) {
        lines.push("  (No drift caught.)");
      } else {
        lines.push(...brief.check.createdDriftQuestions.map(formatBriefNode));
      }
      if (brief.check.catchEventIds.length > 0) {
        lines.push(
          `  catch event id${brief.check.catchEventIds.length === 1 ? "" : "s"}: ${brief.check.catchEventIds.join(", ")}`,
        );
      }
      for (const receipt of brief.check.receiptData) {
        lines.push(
          `  receipt: ${receipt.decisionTitle} · ${receipt.path ?? "unknown"}:${receipt.lineStart ?? "?"}-${receipt.lineEnd ?? "?"} · ${receipt.sourceLabel}`,
        );
      }
      for (const command of brief.check.nextCommands) {
        lines.push(`  accept: ${command.accept}`);
        lines.push(`  dismiss: ${command.dismiss}`);
      }
    }
    return lines.join("\n");
  }

  // truth maintenance brief: source-of-truth state and next human actions.
  if ("sourceOfTruth" in r && "nextActions" in r) {
    const brief = r as {
      sourceOfTruth: {
        decidedGoals: Parameters<typeof formatBriefNode>[0][];
        decidedDecisions: Parameters<typeof formatBriefNode>[0][];
      };
      openProposedGoals: Parameters<typeof formatBriefNode>[0][];
      contestedFacts: Parameters<typeof formatBriefNode>[0][];
      gapQuestions: Parameters<typeof formatBriefNode>[0][];
      pendingCatches: {
        decisionTitle: string;
        path?: string;
        lineStart?: number;
        lineEnd?: number;
      }[];
      connectorHealth: { name: string; kind: string; status: string; lastError?: string }[];
      nextActions: string[];
    };
    const section = (title: string, items: Parameters<typeof formatBriefNode>[0][]) => [
      title,
      items.length === 0 ? "  (None)" : items.map(formatBriefNode).join("\n"),
    ];
    const lines = [
      "Product truth maintenance",
      "",
      ...section("Decided goals", brief.sourceOfTruth.decidedGoals),
      "",
      ...section("Decided decisions", brief.sourceOfTruth.decidedDecisions),
      "",
      ...section("Open proposed goals", brief.openProposedGoals),
      "",
      ...section("Contested facts", brief.contestedFacts),
      "",
      ...section("Gap questions", brief.gapQuestions),
      "",
      "Pending catches",
      brief.pendingCatches.length === 0
        ? "  (None)"
        : brief.pendingCatches
            .map(
              (c) =>
                `  ${c.decisionTitle} · ${c.path ?? "unknown"}:${c.lineStart ?? "?"}-${c.lineEnd ?? "?"}`,
            )
            .join("\n"),
      "",
      "Connector health",
      brief.connectorHealth.length === 0
        ? "  (No connectors configured)"
        : brief.connectorHealth
            .map(
              (c) =>
                `  ${c.name} (${c.kind}) · ${c.status}${c.lastError ? ` · ${c.lastError}` : ""}`,
            )
            .join("\n"),
      "",
      "Next actions",
      ...brief.nextActions.map((action) => `  - ${action}`),
    ];
    return lines.join("\n");
  }

  // answer: the human promote-to-decided confirmation.
  if (Array.isArray(r.promoted)) {
    const promoted = asNodes(r.promoted);
    const superseded = asNodes(r.superseded);
    if (promoted.length === 0 && superseded.length === 0) {
      return "Answer recorded as evidence; no node changed.";
    }
    return [
      ...promoted.map((n) => `Decided: ${nodeTitle(n)} (${n.id})`),
      ...superseded.map((n) => `Superseded: ${nodeTitle(n)} (${n.id})`),
      "Answer recorded as evidence, question closed.",
    ].join("\n");
  }

  // neighbors: a node and the graph neighborhood around it.
  if ("neighbors" in r && Array.isArray(r.neighbors) && "node" in r) {
    const node = r.node as
      | { id: string; kind: string; title: string; status: string }
      | undefined
      | null;
    if (!node) return "(Node not found.)";
    const links = r.neighbors as {
      id: string;
      kind: string;
      title: string;
      status: string;
      depth: number;
      relation?: string;
      edgeConfidence?: number;
    }[];
    const head = `Neighbors of ${node.title} (${node.id}) [${colorStatus(node.status)}]`;
    if (links.length === 0) {
      return `${head}\n  (No linked nodes yet. Edges form as the room is distilled and answered.)`;
    }
    const lines = links.map((nb) => {
      const rel = nb.relation ? ` · ${nb.relation}` : "";
      const conf = nb.edgeConfidence !== undefined ? ` (${nb.edgeConfidence})` : "";
      const hop = `${nb.depth} hop${nb.depth === 1 ? "" : "s"}`;
      return `  [${colorStatus(nb.status)}] ${nb.kind}: ${nb.title}${rel}${conf} · ${hop} · ${nb.id}`;
    });
    return [head, ...lines].join("\n");
  }

  // map: the front-door index, every node with its degree, most connected first.
  if ("index" in r && Array.isArray(r.index)) {
    const entries = r.index as {
      id: string;
      kind: string;
      title: string;
      status: string;
      degree: number;
    }[];
    if (entries.length === 0) {
      return "(The brain is empty. Ingest the room with `marrow add <file>` or `marrow demo`.)";
    }
    const lines = entries.map((e) => {
      const links = `${e.degree} link${e.degree === 1 ? "" : "s"}`;
      return `  [${colorStatus(e.status)}] ${e.kind}: ${e.title}  ${dim(`· ${links} · ${e.id}`)}`;
    });
    return [
      `Index: ${entries.length} node${entries.length === 1 ? "" : "s"}, most connected first`,
      ...lines,
    ].join("\n");
  }

  // verify: the skeptic's pass over the proposed facts.
  if ("results" in r && "flagged" in r && "survived" in r && Array.isArray(r.results)) {
    const rep = r as {
      checked: number;
      survived: number;
      flagged: number;
      results: { kind: string; title: string; verdict: string; reasons: string[] }[];
    };
    if (rep.checked === 0) {
      return "(No proposed facts to verify. The skeptic checks open, model-proposed facts.)";
    }
    const lines = rep.results.map((res) => {
      const mark =
        res.verdict === "survived" ? "[survived]" : `[flagged: ${res.reasons.join(", ")}]`;
      return `  ${mark} ${res.kind}: ${res.title}`;
    });
    return [
      `Skeptic: ${rep.checked} checked, ${rep.survived} survived, ${rep.flagged} flagged`,
      ...lines,
    ].join("\n");
  }

  // lint: the graph-hygiene sweep.
  if ("issues" in r && "counts" in r && Array.isArray(r.issues)) {
    const rep = r as {
      issues: { kind: string; detail: string; nodeIds: string[] }[];
      counts: { duplicateNodes: number; contradictions: number; deadEdges: number };
    };
    if (rep.issues.length === 0) {
      return "Lint: clean. No duplicates, contradictions, or dead edges.";
    }
    const lines = rep.issues.map(
      (issue) => `  [${issue.kind}] ${issue.detail}${dim(` · ${issue.nodeIds.join(", ")}`)}`,
    );
    return [
      `Lint: ${rep.counts.duplicateNodes} duplicate, ${rep.counts.contradictions} contradiction, ${rep.counts.deadEdges} dead edge`,
      ...lines,
    ].join("\n");
  }

  // synthesize: the "what changed and what deserves attention" digest.
  if ("headline" in r && "changed" in r && Array.isArray(r.changed)) {
    const rep = r as {
      windowDays: number;
      headline: string;
      newlyDecided: { kind: string; title: string; status: string }[];
      contested: { kind: string; title: string; status: string }[];
      staleDecided: { kind: string; title: string; status: string }[];
    };
    const section = (
      label: string,
      items: { kind: string; title: string; status: string }[],
    ): string[] =>
      items.length === 0
        ? []
        : ["", label, ...items.map((i) => `  [${colorStatus(i.status)}] ${i.kind}: ${i.title}`)];
    return [
      `Synthesis, last ${rep.windowDays} day${rep.windowDays === 1 ? "" : "s"}`,
      rep.headline,
      ...section("Newly decided", rep.newlyDecided),
      ...section("Contested", rep.contested),
      ...section("Stale, reverify", rep.staleDecided),
    ].join("\n");
  }

  // ingest / import: one or many evidence rows, each with what it distilled.
  for (const key of ["ingested", "imported"] as const) {
    if (Array.isArray(r[key])) {
      const items = r[key].filter(
        (v): v is Record<string, unknown> => typeof v === "object" && v !== null,
      );
      if (items.length === 0) return "(Nothing ingested)";
      const verb = key === "imported" ? "Imported" : "Ingested";
      const head = items.length === 1 ? "" : `${verb} ${items.length} source(s):\n\n`;
      return head + items.map(formatIngestSummary).join("\n\n");
    }
  }

  // add / distill: one evidence row with what it created.
  if (typeof r.evidenceId === "string") {
    return formatIngestSummary(r);
  }

  // onboarding scan: { nodes, questions }.
  if ("nodes" in r && "questions" in r) {
    const all = [...asNodes(r.nodes), ...asNodes(r.questions)];
    return all.length === 0 ? "(Nothing found)" : all.map(formatNode).join("\n");
  }

  // drift: { created, events }.
  if ("created" in r && Array.isArray(r.events)) {
    const created = asNodes(r.created);
    const events = (r.events as unknown[]).length;
    if (created.length === 0)
      return events > 0 ? "(No new drift detected; prior catches logged)" : "(No drift detected)";
    return `${created.map(formatNode).join("\n")}\n${events} catch event${events === 1 ? "" : "s"} recorded.`;
  }

  // drift --ci: { driftCi: { annotations, hasDrift } }
  if ("driftCi" in r && r.driftCi && typeof r.driftCi === "object") {
    const ci = r.driftCi as { annotations: string[]; hasDrift: boolean };
    if (ci.annotations.length === 0) return "(No drift detected in CI)";
    return ci.annotations.join("\n");
  }

  // dismiss: a single question node returned after dismissal.
  if ("kind" in r && (r as { status?: string }).status === "dismissed") {
    const node = asNodes([r])[0];
    if (node) return `Dismissed: ${nodeTitle(node)} (${node.id})\nReason recorded as evidence.`;
  }

  // accept: a single question node promoted to decided after acting on a catch.
  if ("kind" in r && (r as { status?: string }).status === "decided" && "prompt" in r) {
    const node = asNodes([r])[0];
    if (node)
      return `Acted on catch: ${nodeTitle(node)} (${node.id})\nResolution recorded as evidence.`;
  }

  // metrics: { surfaced, actedOn, dismissed, precision, dismissRate }.
  if ("surfaced" in r && "actedOn" in r && "dismissed" in r) {
    const m = r as {
      surfaced: number;
      actedOn: number;
      dismissed: number;
      precision: number | null;
      dismissRate: number | null;
    };
    const p = m.precision === null ? "n/a" : `${(m.precision * 100).toFixed(1)}%`;
    const d = m.dismissRate === null ? "n/a" : `${(m.dismissRate * 100).toFixed(1)}%`;
    return `Catches surfaced: ${m.surfaced}\nActed on: ${m.actedOn}\nDismissed: ${m.dismissed}\nPrecision: ${p}\nDismiss rate: ${d}`;
  }

  // eval report: { precision, recall, f1, cases }.
  if ("precision" in r && "recall" in r && "f1" in r && Array.isArray(r.cases)) {
    const report = r as {
      precision: number;
      recall: number;
      f1: number;
      cases: { name: string; precision: number; recall: number }[];
    };
    const lines = [
      `Precision: ${(report.precision * 100).toFixed(1)}%`,
      `Recall: ${(report.recall * 100).toFixed(1)}%`,
      `F1: ${(report.f1 * 100).toFixed(1)}%`,
      ...report.cases.map(
        (c) =>
          `  ${c.name}: p=${(c.precision * 100).toFixed(0)}% r=${(c.recall * 100).toFixed(0)}%`,
      ),
    ];
    return lines.join("\n");
  }

  // benchmark report: { tokenizer, baseline, marrow, ratio }.
  if (
    "tokenizer" in r &&
    "baseline" in r &&
    "marrow" in r &&
    "ratio" in r &&
    typeof r.tokenizer === "string"
  ) {
    const report = r as {
      tokenizer: string;
      baseline: { docs: number; tokens: number };
      marrow: {
        avgTokens: number;
        avgLatencyMs: number;
        questions: { question: string; tokens: number; latencyMs: number; results: number }[];
      };
      ratio: number;
    };
    const totalResults = report.marrow.questions.reduce((s, q) => s + q.results, 0);
    const lines = [
      `Tokenizer: ${report.tokenizer}`,
      `Baseline docs: ${report.baseline.docs} tokens: ${report.baseline.tokens}`,
      `Marrow avg tokens: ${report.marrow.avgTokens} avg latency: ${report.marrow.avgLatencyMs}ms`,
    ];
    if (totalResults === 0) {
      // retrieval found nothing, so the ratio is not a real reduction (a slice
      // of nothing is trivially smaller than the corpus). This happens when the
      // corpus never distilled into searchable content, e.g. no model is set.
      lines.push(
        "Token reduction ratio: n/a (retrieval returned no results)",
        "Set a model (MARROW_API_KEY, or MARROW_PROVIDER for a local LLM) so the corpus distills and the slice is measured against a real brain.",
      );
    } else {
      lines.push(`Token reduction ratio: ${report.ratio}x`);
    }
    lines.push(
      ...report.marrow.questions.map(
        (q) => `  ${q.question}: ${q.tokens} tokens (${q.latencyMs}ms)`,
      ),
    );
    return lines.join("\n");
  }

  // a single goal just authored or proposed: status + goalType + provenance.
  if ("goal" in r && isNode(r.goal)) {
    return formatNode(r.goal);
  }

  // bounded read lists.
  for (const key of ["results", "decisions", "questions", "goals"] as const) {
    if (Array.isArray(r[key])) {
      const nodes = asNodes(r[key]);
      if (nodes.length === 0) {
        // a search that matches nothing is not the same as an empty brain, so
        // `ask` points at broader terms and browsing instead of implying the
        // ingest failed. the list commands keep the empty-brain hint.
        return key === "results"
          ? "(No matches). Try broader terms, browse with `marrow decisions`, or `marrow add <file>` to ingest more of the room."
          : `(No ${key} yet). If the brain is empty, run \`marrow add <file>\` to ingest the room.`;
      }
      return nodes.map(formatNode).join("\n");
    }
  }

  // connectors: list with sync state.
  if (Array.isArray(r.connectors)) {
    const cs = r.connectors as ConnectorSummary[];
    if (cs.length === 0) {
      return "(No connectors configured). Try `marrow connectors add <kind> --name <n> --secret <s>`.";
    }
    return cs.map(formatConnector).join("\n");
  }

  // a single connector just configured.
  if ("connector" in r && r.connector && typeof r.connector === "object") {
    const c = r.connector as { name: string; kind: string; enabled: boolean; hasSecret: boolean };
    return `Configured ${c.name} (${c.kind}) · ${c.enabled ? "enabled" : "disabled"} · secret ${c.hasSecret ? "stored, encrypted at rest" : "not set"}\nRun \`marrow sync ${c.name}\` to pull now.`;
  }
  if ("connectorEnabled" in r && r.connectorEnabled && typeof r.connectorEnabled === "object") {
    const e = r.connectorEnabled as { name: string; enabled: boolean };
    return `${e.name} ${e.enabled ? "enabled" : "disabled"}.`;
  }
  if (typeof r.connectorRemoved === "string") {
    return `Removed connector ${r.connectorRemoved}. Its evidence stays, append only.`;
  }

  // sync: one or more connector results.
  if (Array.isArray(r.synced)) {
    const results = r.synced as ConnectorSyncResult[];
    if (results.length === 0) return "(No enabled connectors to sync)";
    return results
      .map((s) =>
        s.status === "ok"
          ? `Synced ${s.name}: ${s.itemsIngested} new, ${s.itemsSkipped} already seen`
          : `Sync ${s.name} failed: ${s.error ?? "unknown"}`,
      )
      .join("\n");
  }

  // runs: the observability trace.
  if (Array.isArray(r.runs)) {
    const runs = r.runs as RunRecord[];
    if (runs.length === 0) return "(No runs yet). Distill, search, or sync to record some.";
    return runs.map(formatRun).join("\n");
  }

  // observe: aggregate run metrics.
  if ("byKind" in r && "p50LatencyMs" in r && "totalCostUsd" in r) {
    const m = r as RunMetrics;
    const lines = [
      `Runs: ${m.count} · errors: ${m.errorCount}`,
      `Latency: p50 ${Math.round(m.p50LatencyMs)}ms · p95 ${Math.round(m.p95LatencyMs)}ms`,
      `Tokens: ${m.totalTokensIn} in / ${m.totalTokensOut} out · est cost $${m.totalCostUsd.toFixed(4)}`,
      ...Object.entries(m.byKind).map(
        ([k, v]) =>
          `  ${k}: ${v.count} run(s) · ${Math.round(v.avgLatencyMs)}ms avg · $${v.costUsd.toFixed(4)}`,
      ),
    ];
    return lines.join("\n");
  }

  // single entity, or a clean not-found.
  if ("entity" in r) {
    if (isNode(r.entity)) return formatNode(r.entity);
    const q = typeof r.query === "string" ? ` matching "${r.query}"` : "";
    return `No entity${q}. Try \`marrow ask <term>\`.`;
  }

  // trace to source: one or more spans.
  if (Array.isArray(r.spans) || "spanText" in r) {
    const spans = Array.isArray(r.spans) ? (r.spans as { source: string; spanText: string }[]) : [];
    if (spans.length > 0) {
      return spans.map((s) => `Source: ${s.source}\n  "${s.spanText}"`).join("\n\n");
    }
    if (r.spanText) return `Source: ${String(r.source)}\n  "${String(r.spanText)}"`;
    return "No source spans.";
  }

  return JSON.stringify(result, null, 2);
}
