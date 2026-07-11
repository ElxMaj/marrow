import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type Distilled,
  type EmbeddingProvider,
  type EmbeddingResult,
  Marrow,
  type ModelProvider,
  Store,
  type TranscriptionProvider,
  type VisionProvider,
} from "@marrowhq/core";
import { type Goal, type Question } from "@marrowhq/shared";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { formatResult, runCommand } from "./cli.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const coreMigrate = join(here, "..", "..", "core", "scripts", "migrate.mjs");
const transcript = "the magic link auth flow still needs love before launch";

class FakeModel implements ModelProvider {
  readonly model = "fake-model";
  constructor(private readonly text: string) {}
  complete(): Promise<string> {
    const start = this.text.indexOf("magic link auth");
    return Promise.resolve(
      JSON.stringify({ entities: [{ name: "magic link auth", start, end: start + 15 }] }),
    );
  }
}

class FakeEmbedding implements EmbeddingProvider {
  readonly model = "fake-emb";
  embed(texts: string[]): Promise<EmbeddingResult> {
    return Promise.resolve({ vectors: texts.map(() => [0, 0, 0, 0]), model: this.model, dim: 4 });
  }
}

class FakeVision implements VisionProvider {
  readonly model = "fake-vision";
  lastMediaType: string | undefined;
  lastByteLength = 0;
  describeImage(image: Uint8Array, mediaType?: string): Promise<string> {
    this.lastMediaType = mediaType;
    this.lastByteLength = image.byteLength;
    return Promise.resolve(`whiteboard says magic links only (${mediaType})`);
  }
}

class FakeTranscription implements TranscriptionProvider {
  readonly model = "fake-transcription";
  lastMediaType: string | undefined;
  lastByteLength = 0;
  transcribe(audio: Uint8Array, mediaType?: string): Promise<string> {
    this.lastMediaType = mediaType;
    this.lastByteLength = audio.byteLength;
    return Promise.resolve(`Dana: magic links only (${mediaType})`);
  }
}

function hunk(path: string, newLines: string, lineStart = 1) {
  return {
    path,
    lineStart,
    lineEnd: lineStart + newLines.split("\n").length - 1,
    oldLines: "",
    newLines,
    hunkHeader: "@@ -0,0 +1,1 @@",
  };
}

let store: Store;
let core: Marrow;
let admin: pg.Pool;

function runMainWithoutDb(args: string[]): string {
  const { DATABASE_URL: _dropDatabaseUrl, ...env } = process.env;
  return execFileSync("pnpm", ["exec", "tsx", join(here, "main.ts"), ...args], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });
}

function spawnMain(args: string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync("pnpm", ["exec", "tsx", join(here, "main.ts"), ...args], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });
}

function withoutEnv(...names: string[]): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of names) delete env[name];
  return env;
}

function databaseUrlWithMissingSchema(): string {
  const url = new URL(DATABASE_URL);
  url.searchParams.set("options", "-csearch_path=marrow_missing_schema");
  return url.toString();
}

beforeAll(() => {
  execFileSync("node", [coreMigrate], { env: { ...process.env, DATABASE_URL }, stdio: "ignore" });
  store = new Store(DATABASE_URL);
  core = new Marrow(store, new FakeModel(transcript), new FakeEmbedding());
  admin = new pg.Pool({ connectionString: DATABASE_URL });
});

afterAll(async () => {
  await store.close();
  await admin.end();
});

beforeEach(async () => {
  await admin.query(
    "truncate edge, provenance, embedding, entity, decision, question, goal restart identity cascade",
  );
});

describe("cli", () => {
  it("prints help and version before requiring DATABASE_URL", () => {
    const helpNoArgs = runMainWithoutDb([]);
    expect(helpNoArgs).toContain("Usage: marrow <command>");
    expect(helpNoArgs).toContain("demo");
    expect(helpNoArgs).toContain("web [--open] [--port N]");

    const helpFlag = runMainWithoutDb(["--help"]);
    expect(helpFlag).toBe(helpNoArgs);

    const helpCommand = runMainWithoutDb(["help"]);
    expect(helpCommand).toBe(helpNoArgs);

    const version = runMainWithoutDb(["--version"]).trim();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("demo runs keyless even when the brain already has an embedding profile", async () => {
    await store.insertEmbedding({
      nodeId: "seed-existing-profile",
      nodeKind: "entity",
      model: "fake-emb",
      dim: 4,
      vector: [0, 0, 0, 0],
    });

    const result = spawnMain(["demo"], { ...process.env, DATABASE_URL });

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("embedding provider mismatch");
    expect(result.stdout).toContain("Marrow demo: the room, distilled");
    expect(result.stdout).toContain("Decision  [decided]");
    expect(result.stdout).toContain("Confidence 1 (human)");
    expect(result.stdout).toContain("interviews/design-partner.md");
  });

  it("answer promotes the related node to decided and records the answer as evidence", async () => {
    await core.ingestAndDistill({ text: transcript, source: "interviews/pfc-gdynia.md" });

    const out = (await runCommand(core, ["questions"])) as { questions: Question[] };
    const gap = out.questions.find((q) => /never decided|specify/i.test(q.prompt));
    if (!gap) throw new Error("expected a gap question");
    const relatedId = gap.relatesTo?.[0];
    if (!relatedId) throw new Error("expected the question to relate to a node");

    await runCommand(core, ["answer", gap.id, "--text", "yes, magic links only"]);

    const node = await core.getNode(relatedId);
    expect(node?.status).toBe("decided");
    expect(node?.confidence.source).toBe("human");
    expect((await core.searchEvidence("magic links only")).length).toBeGreaterThan(0);
  });

  it("ask mirrors the search data with status and provenance", async () => {
    await core.ingestAndDistill({ text: transcript, source: "x" });
    const out = (await runCommand(core, ["ask", "magic"])) as { results: Distilled[] };
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.results[0]?.status).toBeDefined();
    expect(out.results[0]?.provenance.length).toBeGreaterThan(0);
  });

  it("formats nodes with their status badge", async () => {
    await core.ingestAndDistill({ text: transcript, source: "x" });
    const text = formatResult(await runCommand(core, ["ask", "magic"]));
    expect(text).toMatch(/\[open\]|\[decided\]/);
  });

  it("decisions filters by status and rejects an invalid status", async () => {
    const ev = await store.insertEvidence({
      text: "auth decisions for cli filtering",
      source: "tests/cli-decisions.md",
    });
    const provenance = [{ evidenceId: ev.id, start: 0, end: 4 }];
    const decided = await store.insertDecision({
      title: "Magic links stay",
      rationale: "",
      constraint: false,
      status: "decided",
      confidence: { value: 1, source: "human" },
      provenance,
    });
    const open = await store.insertDecision({
      title: "Passkeys need review",
      rationale: "",
      constraint: false,
      status: "open",
      confidence: { value: 0.5, source: "model" },
      provenance,
    });

    const out = (await runCommand(core, ["decisions", "--status", "decided"])) as {
      decisions: { id: string; status: string; provenance: unknown[] }[];
    };
    expect(out.decisions.map((d) => d.id)).toEqual([decided.id]);
    expect(out.decisions.map((d) => d.id)).not.toContain(open.id);
    expect(out.decisions[0]?.status).toBe("decided");
    expect(out.decisions[0]?.provenance.length).toBeGreaterThan(0);
    expect(formatResult(out)).toMatch(/\[decided\] decision: Magic links stay/);

    await expect(runCommand(core, ["decisions", "--status", "bogus"])).rejects.toThrow(
      /Invalid --status; one of/i,
    );
  });

  it("trace renders the exact source spans and requires a node id", async () => {
    const text = "Auth uses magic links because shared passwords are unsafe";
    const ev = await store.insertEvidence({ text, source: "interviews/trace.md" });
    const phrase = "magic links";
    const start = text.indexOf(phrase);
    const decision = await store.insertDecision({
      title: "Auth uses magic links",
      rationale: "",
      constraint: false,
      status: "decided",
      confidence: { value: 1, source: "human" },
      provenance: [{ evidenceId: ev.id, start, end: start + phrase.length }],
    });

    const result = await runCommand(core, ["trace", decision.id]);
    const rendered = formatResult(result);
    expect(rendered).toContain("Source: interviews/trace.md");
    expect(rendered).toContain(`"${phrase}"`);

    await expect(runCommand(core, ["trace"])).rejects.toThrow(/Usage: marrow trace <nodeId>/);
  });

  it("neighbors renders the linked nodes and requires a node id", async () => {
    const ev = await store.insertEvidence({ text: "checkout notes", source: "room/n.md" });
    const provenance = [{ evidenceId: ev.id, start: 0, end: 8 }];
    const ent = await store.insertEntity({
      name: "checkout",
      status: "open",
      confidence: { value: 0.6, source: "model" },
      provenance,
    });
    const dec = await store.insertDecision({
      title: "one-click checkout",
      rationale: "fewer steps",
      constraint: false,
      status: "decided",
      confidence: { value: 1, source: "human" },
      provenance,
    });
    await store.insertEdge({
      fromId: ent.id,
      fromKind: "entity",
      toId: dec.id,
      toKind: "decision",
      relation: "concerns",
      confidence: 0.6,
      source: "rule",
    });

    const rendered = formatResult(await runCommand(core, ["neighbors", ent.id]));
    expect(rendered).toContain("Neighbors of checkout");
    expect(rendered).toContain("one-click checkout");
    expect(rendered).toContain("concerns");

    await expect(runCommand(core, ["neighbors"])).rejects.toThrow(/Usage: marrow neighbors/);
  });

  it("map renders the front-door index with degrees, most connected first", async () => {
    const ev = await store.insertEvidence({ text: "checkout notes", source: "room/m.md" });
    const provenance = [{ evidenceId: ev.id, start: 0, end: 8 }];
    const ent = await store.insertEntity({
      name: "checkout",
      status: "open",
      confidence: { value: 0.6, source: "model" },
      provenance,
    });
    const dec = await store.insertDecision({
      title: "one-click checkout",
      rationale: "fewer steps",
      constraint: false,
      status: "decided",
      confidence: { value: 1, source: "human" },
      provenance,
    });
    await store.insertEdge({
      fromId: ent.id,
      fromKind: "entity",
      toId: dec.id,
      toKind: "decision",
      relation: "concerns",
      confidence: 0.6,
      source: "rule",
    });

    const rendered = formatResult(await runCommand(core, ["map"]));
    expect(rendered).toContain("most connected first");
    expect(rendered).toContain("checkout");
    expect(rendered).toMatch(/link/);
  });

  it("decisions shows a verified date on a human-promoted fact", async () => {
    const ev = await store.insertEvidence({ text: "auth decision here", source: "room/vd.md" });
    const dec = await store.insertDecision({
      title: "Use passkeys everywhere",
      rationale: "phishing resistance",
      constraint: false,
      status: "open",
      confidence: { value: 0.6, source: "model" },
      provenance: [{ evidenceId: ev.id, start: 0, end: 4 }],
    });
    await store.promoteToDecided(dec.id, "decision", { evidenceId: ev.id, start: 0, end: 4 });

    const out = formatResult(await runCommand(core, ["decisions", "--status", "decided"]));
    expect(out).toContain("Use passkeys everywhere");
    expect(out).toContain("verified");
  });

  it("lint reports graph-hygiene issues", async () => {
    const ev = await store.insertEvidence({ text: "auth notes here", source: "room/lint.md" });
    const prov = [{ evidenceId: ev.id, start: 0, end: 4 }];
    await store.insertEntity({
      name: "Checkout",
      status: "open",
      confidence: { value: 0.6, source: "model" },
      provenance: prov,
    });
    await store.insertEntity({
      name: "checkout",
      status: "open",
      confidence: { value: 0.6, source: "model" },
      provenance: prov,
    });
    const out = formatResult(await runCommand(core, ["lint"]));
    expect(out).toContain("duplicate");
  });

  it("synthesize reports what changed over a window", async () => {
    const ev = await store.insertEvidence({ text: "auth notes here", source: "room/syn.md" });
    await store.insertDecision({
      title: "auth uses passkeys",
      rationale: "",
      constraint: false,
      status: "decided",
      confidence: { value: 1, source: "human" },
      provenance: [{ evidenceId: ev.id, start: 0, end: 4 }],
    });
    const out = formatResult(await runCommand(core, ["synthesize"]));
    expect(out).toContain("Synthesis");
  });

  it("rejects an unknown command", async () => {
    await expect(runCommand(core, ["frobnicate"])).rejects.toThrow(/Unknown command/);
  });

  it("maps usage errors to exit code 2 in the process entrypoint", () => {
    const result = spawnMain(["frobnicate"], { ...process.env, DATABASE_URL });

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Unknown command/);
  });

  it("maps infrastructure and generic failures to distinct process exit codes", () => {
    const missingDb = spawnMain(["ask", "magic"], withoutEnv("DATABASE_URL"));
    expect(missingDb.status).toBe(3);
    expect(missingDb.stderr).toContain("DATABASE_URL is not set");

    const refused = spawnMain(["ask", "magic"], {
      ...process.env,
      DATABASE_URL: "postgres://marrow:marrow@127.0.0.1:1/marrow",
    });
    expect(refused.status).toBe(3);
    expect(refused.stderr).toContain("Is Postgres reachable?");

    const missingSchema = spawnMain(["ask", "magic"], {
      ...process.env,
      DATABASE_URL: databaseUrlWithMissingSchema(),
    });
    expect(missingSchema.status).toBe(3);
    expect(missingSchema.stderr).toContain("Run `marrow migrate`");

    const generic = spawnMain(
      ["connectors", "add", "slack", "--name", "slack-generic", "--secret", "xoxb"],
      { ...withoutEnv("MARROW_SECRET_KEY"), DATABASE_URL },
    );
    expect(generic.status).toBe(1);
    expect(generic.stderr).toContain("MARROW_SECRET_KEY is not set");
  });

  it("add ingests and distills when a model and embedding are configured", async () => {
    const file = join(tmpdir(), "marrow-cli-add.md");
    writeFileSync(file, transcript);
    const out = (await runCommand(core, ["add", file, "--source", "standups/x.md"])) as {
      evidenceId: string;
      nodes: Distilled[];
    };
    expect(out.evidenceId).toMatch(/^ev_/);
    expect(out.nodes.some((n) => n.kind === "entity")).toBe(true);
    expect(formatResult(out)).toMatch(/Distilled \d+ node/);
  });

  it("add honors --no-distill, storing evidence without distilling", async () => {
    // core has a model configured, so distillation is possible; the flag must
    // still suppress it instead of being silently dropped.
    const file = join(tmpdir(), "marrow-cli-add-nodistill.md");
    writeFileSync(file, transcript);
    const out = (await runCommand(core, [
      "add",
      file,
      "--source",
      "standups/nd.md",
      "--no-distill",
    ])) as { evidenceId: string; distilled: boolean; nodes?: Distilled[] };
    expect(out.evidenceId).toMatch(/^ev_/);
    expect(out.distilled).toBe(false);
    expect(out.nodes).toBeUndefined();
  });

  it("add stores evidence and reports the next step when distillation is unconfigured", async () => {
    const bare = new Marrow(store); // no model or embedding
    const file = join(tmpdir(), "marrow-cli-add2.md");
    writeFileSync(file, transcript);
    const out = (await runCommand(bare, ["add", file])) as {
      evidenceId: string;
      distilled: boolean;
    };
    expect(out.distilled).toBe(false);
    expect(formatResult(out)).toMatch(/marrow distill/);
  });

  it("distill processes an already-ingested evidence row", async () => {
    const id = await core.ingest({ text: transcript, source: "x" });
    const out = (await runCommand(core, ["distill", id])) as { nodes: Distilled[] };
    expect(out.nodes.some((n) => n.kind === "entity")).toBe(true);
  });

  it("answer output names what was decided instead of dumping JSON", async () => {
    await core.ingestAndDistill({ text: transcript, source: "x" });
    const q = (await runCommand(core, ["questions"])) as { questions: Question[] };
    const gap = q.questions.find((x) => /never decided|specify/i.test(x.prompt));
    if (!gap) throw new Error("expected a gap question");
    const text = formatResult(await runCommand(core, ["answer", gap.id, "--text", "yes"]));
    expect(text).toMatch(/^Decided: /m);
    expect(text).toMatch(/question closed/);
  });

  it("entity not found returns a clean message, not raw JSON", async () => {
    const text = formatResult(await runCommand(core, ["entity", "nope-no-such"]));
    expect(text).toMatch(/No entity matching "nope-no-such"/);
  });

  it("an empty read hints at how to fill the brain", async () => {
    const text = formatResult(await runCommand(core, ["ask", "anything"]));
    expect(text).toMatch(/marrow add/);
  });

  // a real meeting transcript arrives as a VTT/SRT/JSON export, not clean prose.
  // ingestion must strip the format noise and keep the spoken words + speakers,
  // so provenance spans land on what was actually said.
  it("ingest sweeps a directory and normalizes each transcript format", async () => {
    const bare = new Marrow(store); // no model: assert parsing, not distillation
    const dir = mkdtempSync(join(tmpdir(), "marrow-ingest-"));
    writeFileSync(
      join(dir, "call.vtt"),
      "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\n<v Alice>we decided magic links</v>\n\n2\n00:00:05.000 --> 00:00:08.000\n<v Bob>no shared passwords</v>\n",
    );
    writeFileSync(join(dir, "note.md"), "plain decision note");

    const out = (await runCommand(bare, ["ingest", dir])) as {
      ingested: { format: string; speakers: string[]; evidenceId: string; distilled: boolean }[];
    };
    expect(out.ingested).toHaveLength(2);
    const vtt = out.ingested.find((i) => i.format === "vtt");
    expect(vtt?.speakers).toEqual(["Alice", "Bob"]);
    expect(vtt?.evidenceId).toMatch(/^ev_/);

    const stored = await bare.getEvidence(vtt?.evidenceId ?? "");
    expect(stored?.text).toContain("Alice: we decided magic links");
    expect(stored?.text).toContain("Bob: no shared passwords");
    expect(stored?.text).not.toMatch(/00:00|WEBVTT|<v /); // format noise is gone
  });

  it("add is format-aware: a VTT is normalized to speaker text before storing", async () => {
    const bare = new Marrow(store);
    const file = join(tmpdir(), "marrow-add.vtt");
    writeFileSync(
      file,
      "WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\n<v Dana>billing must be idempotent</v>\n",
    );
    const out = (await runCommand(bare, ["add", file])) as { evidenceId: string; format?: string };
    expect(out.format).toBe("vtt");
    const stored = await bare.getEvidence(out.evidenceId);
    expect(stored?.text).toBe("Dana: billing must be idempotent");
  });

  it("ingest --audio transcribes bytes through the provider with source and media type", async () => {
    const transcription = new FakeTranscription();
    const mediaCore = new Marrow(store, undefined, undefined, undefined, undefined, transcription);
    const file = join(tmpdir(), "marrow-voice.mp3");
    writeFileSync(file, Buffer.from([1, 2, 3, 4]));

    const out = (await runCommand(mediaCore, [
      "ingest",
      "--audio",
      file,
      "--source",
      "voice/auth.mp3",
      "--no-distill",
    ])) as { ingested: { source: string; evidenceId: string; distilled: boolean }[] };

    expect(transcription.lastMediaType).toBe("audio/mpeg");
    expect(transcription.lastByteLength).toBe(4);
    expect(out.ingested[0]).toMatchObject({ source: "voice/auth.mp3", distilled: false });
    const stored = await mediaCore.getEvidence(out.ingested[0]?.evidenceId ?? "");
    expect(stored?.source).toBe("voice/auth.mp3");
    expect(stored?.text).toBe("Dana: magic links only (audio/mpeg)");
  });

  it("ingest --image describes bytes through the provider with source and media type", async () => {
    const vision = new FakeVision();
    const mediaCore = new Marrow(store, undefined, undefined, undefined, vision);
    const file = join(tmpdir(), "marrow-whiteboard.jpg");
    writeFileSync(file, Buffer.from([9, 8, 7]));

    const out = (await runCommand(mediaCore, [
      "ingest",
      "--image",
      file,
      "--source",
      "whiteboards/auth.jpg",
      "--no-distill",
    ])) as { ingested: { source: string; evidenceId: string; distilled: boolean }[] };

    expect(vision.lastMediaType).toBe("image/jpeg");
    expect(vision.lastByteLength).toBe(3);
    expect(out.ingested[0]).toMatchObject({ source: "whiteboards/auth.jpg", distilled: false });
    const stored = await mediaCore.getEvidence(out.ingested[0]?.evidenceId ?? "");
    expect(stored?.source).toBe("whiteboards/auth.jpg");
    expect(stored?.text).toBe("whiteboard says magic links only (image/jpeg)");
  });

  it("ingest output names each source with its detected format and speaker count", () => {
    const text = formatResult({
      ingested: [
        {
          source: "call.vtt",
          format: "vtt",
          speakers: ["Alice", "Bob"],
          evidenceId: "ev_x",
          distilled: false,
        },
      ],
    });
    expect(text).toMatch(/call\.vtt \[vtt\]/);
    expect(text).toMatch(/2 speaker/);
  });

  it("drift --ci returns GitHub Actions annotations", async () => {
    const ev = await store.insertEvidence({ text: "no passwords", source: "x" });
    await store.insertDecision({
      title: "no passwords, magic links only",
      rationale: "",
      constraint: false,
      status: "decided",
      confidence: { value: 1, source: "human" },
      provenance: [{ evidenceId: ev.id, start: 0, end: 12 }],
    });

    // Hermetic: scan an isolated throwaway git repo with an unstaged change that
    // contradicts the decided "no passwords", instead of "." — `git diff` is not
    // scoped to a subdir, so pointing drift at the marrow tree makes the test
    // pass or fail on whatever is uncommitted. See drift-test-hermetic.
    const repo = mkdtempSync(join(tmpdir(), "marrow-drift-ci-"));
    const git = (...args: string[]): void =>
      void execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    try {
      git("init");
      git("config", "user.email", "test@marrow.dev");
      git("config", "user.name", "test");
      const file = join(repo, "auth.ts");
      writeFileSync(file, "export function login() {\n  return magicLink();\n}\n");
      git("add", "-A");
      git("commit", "-m", "baseline");
      writeFileSync(
        file,
        "export function login(password: string) {\n  const passwordHash = hash(password);\n  return passwordHash;\n}\n",
      );

      const out = (await runCommand(core, ["drift", repo, "--ci", "--no-semantic"])) as unknown;
      const text = formatResult(out);
      expect(text).toMatch(/::error file=/);
      expect(text).toMatch(/no passwords/);
      expect((out as { driftCi?: { hasDrift?: boolean } }).driftCi?.hasDrift).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("drift uses task scope flags without mistaking --since values for repo paths", async () => {
    const calls: {
      repoPath: string;
      options: { scope?: string; semantic?: boolean; trigger?: string };
    }[] = [];
    const fakeCore = {
      driftScan: async (
        repoPath: string,
        options: { scope?: string; semantic?: boolean; trigger?: string },
      ) => {
        calls.push({ repoPath, options });
        return { created: [], events: [] };
      },
    } as unknown as Marrow;

    const sinceOut = await runCommand(fakeCore, ["drift", "--since", "HEAD~1", "--no-semantic"]);
    expect(sinceOut).toEqual({ created: [], events: [] });
    expect(calls[0]).toEqual({
      repoPath: process.cwd(),
      options: { scope: "HEAD~1", semantic: false, trigger: "cli" },
    });

    await runCommand(fakeCore, ["drift", "--staged", "/tmp/repo"]);
    expect(calls[1]).toEqual({
      repoPath: "/tmp/repo",
      options: { scope: "staged", semantic: true, trigger: "cli" },
    });
  });

  it("drift returns open questions and catch-event counts on the plain CLI path", async () => {
    const ev = await store.insertEvidence({ text: "no passwords", source: "x" });
    const decision = await store.insertDecision({
      title: "no passwords, magic links only",
      rationale: "",
      constraint: false,
      status: "decided",
      confidence: { value: 1, source: "human" },
      provenance: [{ evidenceId: ev.id, start: 0, end: 12 }],
    });

    const repo = mkdtempSync(join(tmpdir(), "marrow-drift-plain-"));
    const git = (...args: string[]): void =>
      void execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    try {
      git("init");
      git("config", "user.email", "test@marrow.dev");
      git("config", "user.name", "test");
      const file = join(repo, "auth.ts");
      writeFileSync(file, "export function login() {\n  return magicLink();\n}\n");
      git("add", "-A");
      git("commit", "-m", "baseline");
      writeFileSync(
        file,
        "export function login(password: string) {\n  const passwordHash = hash(password);\n  return passwordHash;\n}\n",
      );

      const out = (await runCommand(core, ["drift", repo, "--no-semantic"])) as {
        created: Distilled[];
        events: { id: string }[];
      };
      const rendered = formatResult(out);

      const questions = out.created.filter((n): n is Question => n.kind === "question");
      expect(questions.some((q) => q.status === "open")).toBe(true);
      expect(questions.some((q) => q.relatesTo?.includes(decision.id))).toBe(true);
      expect(out.events.length).toBeGreaterThan(0);
      expect(rendered).toMatch(/\[open\] question:/);
      expect(rendered).toMatch(
        /catch event\(s\) recorded|catch events recorded|catch event recorded/,
      );
      expect((await core.getNode(decision.id))?.status).toBe("decided");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("init proposes repo hints and open questions without deciding truth", async () => {
    const repo = mkdtempSync(join(tmpdir(), "marrow-init-"));
    try {
      writeFileSync(repo + "/package.json", JSON.stringify({ dependencies: { stripe: "latest" } }));
      mkdirSync(join(repo, "src", "auth"), { recursive: true });

      const out = (await runCommand(core, ["init", repo])) as {
        nodes: Distilled[];
        questions: Distilled[];
      };

      const entityNames = out.nodes.flatMap((n) => (n.kind === "entity" ? [n.name] : []));
      expect(entityNames).toEqual(expect.arrayContaining(["stripe", "auth"]));
      expect(out.nodes.every((n) => n.status === "open")).toBe(true);
      expect(out.nodes.every((n) => n.confidence.source === "model")).toBe(true);
      expect(out.nodes.every((n) => n.confidence.value < 0.5)).toBe(true);
      expect(out.questions.length).toBeGreaterThan(0);
      expect(out.questions.every((q) => q.status === "open")).toBe(true);
      expect(formatResult(out)).toMatch(/\[open\]/);

      const firstEntity = out.nodes.find((n) => n.kind === "entity");
      if (!firstEntity) throw new Error("expected an entity");
      const trace = await core.traceToSource(firstEntity.id);
      expect(trace.source?.startsWith("repo:")).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  async function seedCliCatch() {
    const title = "magic links only, no passwords";
    const ev = await store.insertEvidence({ text: title, source: "tests/cli-catch.md" });
    const provenance = [{ evidenceId: ev.id, start: 0, end: title.length }];
    const decision = await store.insertDecision({
      title,
      rationale: "",
      constraint: false,
      status: "decided",
      confidence: { value: 1, source: "human" },
      provenance,
    });
    const question = await store.insertQuestion({
      prompt: `drift: src/auth.ts:1-1 contradicts decided fact "${title}"`,
      status: "open",
      confidence: { value: 0.8, source: "model" },
      relatesTo: [decision.id],
      provenance,
    });
    await store.insertCatchEvent({
      eventType: "catch_surfaced",
      questionId: question.id,
      decisionId: decision.id,
      repoPath: "/tmp/marrow-cli-catch",
      diffSpan: {
        path: "src/auth.ts",
        lineStart: 1,
        lineEnd: 1,
        hunkText: "const passwordHash = hash(password);",
      },
      trigger: "cli",
      confidence: 0.8,
    });
    return { decision, question };
  }

  it("dismiss marks a drift catch as noise and metrics count the dismissal", async () => {
    const { decision, question } = await seedCliCatch();

    const dismissed = (await runCommand(core, [
      "dismiss",
      question.id,
      "--reason",
      "test fixture, not product code",
    ])) as Question;

    expect(dismissed.status).toBe("dismissed");
    expect(dismissed.confidence.source).toBe("human");
    expect(formatResult(dismissed)).toMatch(/Dismissed:/);
    const events = await store.listCatchEvents({
      decisionId: decision.id,
      eventType: "catch_dismissed",
    });
    expect(events).toHaveLength(1);
    await store.insertCatchEvent({
      eventType: "catch_surfaced",
      questionId: question.id,
      decisionId: decision.id,
      trigger: "eval",
      synthetic: true,
    });

    const metrics = (await runCommand(core, ["metrics"])) as {
      surfaced: number;
      dismissed: number;
      precision: number | null;
      dismissRate: number | null;
    };
    expect(metrics).toMatchObject({
      surfaced: 1,
      dismissed: 1,
      precision: 0,
      dismissRate: 1,
    });
    expect(formatResult(metrics)).toContain("Dismiss rate: 100.0%");

    const withSynthetic = (await runCommand(core, ["metrics", "--include-synthetic"])) as {
      surfaced: number;
    };
    expect(withSynthetic.surfaced).toBe(2);
    const futureWindow = (await runCommand(core, [
      "metrics",
      "--since",
      "2999-01-01T00:00:00.000Z",
    ])) as { surfaced: number; dismissed: number };
    expect(futureWindow).toMatchObject({ surfaced: 0, dismissed: 0 });
  });

  it("accept records catch action and human resolution evidence", async () => {
    const { decision, question } = await seedCliCatch();

    const accepted = (await runCommand(core, [
      "accept",
      question.id,
      "--text",
      "removed the password branch",
    ])) as Question;

    expect(accepted.status).toBe("decided");
    expect(accepted.confidence.source).toBe("human");
    expect(formatResult(accepted)).toMatch(/Acted on catch:/);
    expect(await core.searchEvidence("removed the password branch")).toHaveLength(1);
    const events = await store.listCatchEvents({
      decisionId: decision.id,
      eventType: "catch_acted_on",
    });
    expect(events).toHaveLength(1);
  });

  it("eval runs a fixture and renders precision, recall and f1", async () => {
    const fixture = join(tmpdir(), "marrow-cli-eval.json");
    writeFileSync(
      fixture,
      JSON.stringify([
        {
          name: "password-drift",
          decisions: [{ title: "no passwords, magic links only" }],
          hunks: [hunk("src/auth.ts", "const passwordHash = hash(password);")],
          expected: [{ hunkIndex: 0, decisionIndex: 0 }],
          synthetic: true,
        },
      ]),
    );

    const report = (await runCommand(core, ["eval", fixture])) as {
      precision: number;
      recall: number;
      f1: number;
      cases: { name: string }[];
    };

    expect(report.precision).toBe(1);
    expect(report.recall).toBe(1);
    expect(report.f1).toBe(1);
    const rendered = formatResult(report);
    expect(rendered).toContain("Precision: 100.0%");
    expect(rendered).toContain("password-drift");
  });

  it("import ingests markdown docs with doc-specific source labels", async () => {
    const bare = new Marrow(store);
    const dir = mkdtempSync(join(tmpdir(), "marrow-import-"));
    writeFileSync(join(dir, "CLAUDE.md"), "we decided magic links only");
    writeFileSync(join(dir, "note.md"), "plain decision note");
    const out = (await runCommand(bare, ["import", dir])) as {
      imported: { source: string; evidenceId: string }[];
    };
    expect(out.imported).toHaveLength(2);
    const claude = out.imported.find((i) => i.source === "repo:docs/CLAUDE.md");
    expect(claude).toBeDefined();
    const stored = await bare.getEvidence(claude?.evidenceId ?? "");
    expect(stored?.text).toContain("magic links only");
  });

  it("watch ingests a newly created file", async () => {
    const bare = new Marrow(store);
    const dir = mkdtempSync(join(tmpdir(), "marrow-watch-"));
    const { watchFolder } = await import("./watch.js");
    const file = join(dir, "drop.md");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let markIngested: (path: string) => void = () => {};
    const ingested = new Promise<string>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("watch did not ingest the dropped file")), 1500);
      markIngested = (path) => {
        if (timeout) clearTimeout(timeout);
        resolve(path);
      };
    });

    const watcher = await watchFolder({
      folder: dir,
      core: bare,
      distill: false,
      debounceMs: 100,
      onIngested: markIngested,
    });
    try {
      writeFileSync(file, "watched folder decision note");
      await expect(ingested).resolves.toBe(file);
    } finally {
      watcher.close();
      if (timeout) clearTimeout(timeout);
    }

    const stored = (await bare.searchEvidence("watched folder")).find((e) => e.source === file);
    expect(stored).toBeDefined();
  });

  it("watch reports ingestion of an already-present new file", async () => {
    const bare = new Marrow(store);
    const dir = mkdtempSync(join(tmpdir(), "marrow-watch-catchup-"));
    const { watchFolder } = await import("./watch.js");
    const file = join(dir, "drop.md");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let markIngested: (path: string) => void = () => {};
    const ingested = new Promise<string>((resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error("startup sweep did not ingest the dropped file")),
        1500,
      );
      markIngested = (path) => {
        if (timeout) clearTimeout(timeout);
        resolve(path);
      };
    });

    writeFileSync(file, "watched folder decision note");
    const watcher = await watchFolder({
      folder: dir,
      core: bare,
      distill: false,
      debounceMs: 100,
      onIngested: markIngested,
    });
    try {
      await expect(ingested).resolves.toBe(file);
    } finally {
      watcher.close();
      if (timeout) clearTimeout(timeout);
    }

    const stored = (await bare.searchEvidence("watched folder")).find((e) => e.source === file);
    expect(stored).toBeDefined();
  });

  // goals are a node kind like decisions/questions: the human authors a decided
  // goal, an agent proposes an open one, and every result carries status +
  // provenance so decided is always told from proposed.
  it("goal author creates a decided, human goal with provenance", async () => {
    const out = (await runCommand(core, [
      "goal",
      "author",
      "users can reset their own password",
      "--type",
      "user",
      "--description",
      "no support ticket needed",
    ])) as { goal: Goal };
    expect(out.goal.kind).toBe("goal");
    expect(out.goal.status).toBe("decided");
    expect(out.goal.confidence.source).toBe("human");
    expect(out.goal.goalType).toBe("user");
    expect(out.goal.description).toBe("no support ticket needed");
    // the authored text is captured as immutable evidence and the goal cites it.
    expect(out.goal.provenance.length).toBeGreaterThan(0);
  });

  it("goal propose creates an OPEN, model goal and requires provenance", async () => {
    const evidenceId = await core.ingest({ text: "we want fast onboarding", source: "x" });
    const out = (await runCommand(core, [
      "goal",
      "propose",
      "onboarding under five minutes",
      "--type",
      "product",
      "--evidence",
      evidenceId,
      "--start",
      "0",
      "--end",
      "23",
    ])) as { goal: Goal };
    expect(out.goal.status).toBe("open");
    expect(out.goal.confidence.source).toBe("model");
    expect(out.goal.goalType).toBe("product");
    expect(out.goal.provenance[0]?.evidenceId).toBe(evidenceId);

    // an agent cannot propose a goal without pointing at an evidence span.
    await expect(
      runCommand(core, ["goal", "propose", "no provenance here", "--type", "product"]),
    ).rejects.toThrow(/provenance|evidence/i);
  });

  it("goals lists authored and proposed goals with status, provenance, and filters", async () => {
    await runCommand(core, ["goal", "author", "ship a stable public API", "--type", "product"]);
    const evidenceId = await core.ingest({ text: "users want SSO login", source: "x" });
    await runCommand(core, [
      "goal",
      "propose",
      "support SSO login",
      "--type",
      "user",
      "--evidence",
      evidenceId,
      "--start",
      "0",
      "--end",
      "14",
    ]);

    const all = (await runCommand(core, ["goals"])) as { goals: Goal[] };
    expect(all.goals.length).toBe(2);
    for (const g of all.goals) {
      expect(g.status).toBeDefined();
      expect(g.provenance.length).toBeGreaterThan(0);
    }
    expect(all.goals.some((g) => g.status === "decided")).toBe(true);
    expect(all.goals.some((g) => g.status === "open")).toBe(true);

    const userOnly = (await runCommand(core, ["goals", "--type", "user"])) as { goals: Goal[] };
    expect(userOnly.goals.length).toBe(1);
    expect(userOnly.goals.every((g) => g.goalType === "user")).toBe(true);

    const decidedOnly = (await runCommand(core, ["goals", "--status", "decided"])) as {
      goals: Goal[];
    };
    expect(decidedOnly.goals.length).toBe(1);
    expect(decidedOnly.goals.every((g) => g.status === "decided")).toBe(true);
  });

  it("formats a goal with its status badge, goal type and provenance", async () => {
    const authored = await runCommand(core, [
      "goal",
      "author",
      "reduce churn to under two percent",
      "--type",
      "product",
    ]);
    const text = formatResult(authored);
    expect(text).toMatch(/\[decided\]/);
    expect(text).toMatch(/goal/);
    expect(text).toMatch(/product/);
    expect(text).toMatch(/reduce churn to under two percent/);

    const list = formatResult(await runCommand(core, ["goals"]));
    expect(list).toMatch(/\[decided\]/);
    expect(list).toMatch(/reduce churn to under two percent/);
  });

  it("loop returns a task brief with safe-to-build and ask-human-first sections", async () => {
    const fake = {
      prepareTask: vi.fn().mockResolvedValue({
        task: "implement password login",
        status: "ask_human_first",
        safeToBuild: {
          facts: [
            {
              id: "dec_1",
              kind: "decision",
              title: "Auth uses magic links, no passwords",
              status: "decided",
              confidence: { value: 1, source: "human" },
              provenance: [
                {
                  evidenceId: "ev_1",
                  source: "interviews/auth.md",
                  start: 18,
                  end: 44,
                  spanText: "magic links, no passwords",
                },
              ],
            },
          ],
        },
        askHumanFirst: {
          questions: [
            {
              id: "q_1",
              kind: "question",
              title: "Do admins need recovery?",
              status: "open",
              confidence: { value: 0.6, source: "model" },
              provenance: [
                {
                  evidenceId: "ev_1",
                  source: "interviews/auth.md",
                  start: 0,
                  end: 4,
                  spanText: "Dana",
                },
              ],
            },
          ],
        },
      }),
    } as unknown as Marrow;

    const out = await runCommand(fake, ["loop", "implement password login"]);
    expect(fake.prepareTask).toHaveBeenCalledWith("implement password login", {
      check: false,
      repoPath: process.cwd(),
      scope: "unstaged",
      semantic: true,
    });
    const rendered = formatResult(out);
    expect(rendered).toContain("Safe to build");
    expect(rendered).toContain("Auth uses magic links, no passwords");
    expect(rendered).toContain("Ask a human first");
    expect(rendered).toContain("interviews/auth.md");
  });

  it("loop --check maps diff flags and renders catch next commands", async () => {
    const fake = {
      prepareTask: vi.fn().mockResolvedValue({
        task: "implement password login",
        status: "ask_human_first",
        safeToBuild: { facts: [] },
        askHumanFirst: { questions: [] },
        check: {
          createdDriftQuestions: [
            {
              id: "q_9",
              kind: "question",
              title: "drift: code may contradict magic links",
              status: "open",
              confidence: { value: 0.8, source: "model" },
              provenance: [
                {
                  evidenceId: "ev_9",
                  source: "repo:src/auth.ts:1-1",
                  start: 0,
                  end: 12,
                  spanText: "passwordHash",
                },
              ],
            },
          ],
          catchEventIds: [42],
          receiptData: [
            {
              id: "q_9",
              status: "open",
              decisionTitle: "Auth uses magic links, no passwords",
              path: "src/auth.ts",
              lineStart: 1,
              lineEnd: 1,
              sourceLabel: "1 evidence span",
              surfacedAt: "2026-06-28T00:00:00.000Z",
            },
          ],
          nextCommands: [
            {
              questionId: "q_9",
              accept: 'marrow accept q_9 --text "..."',
              dismiss: 'marrow dismiss q_9 --reason "..."',
            },
          ],
        },
      }),
    } as unknown as Marrow;

    const out = await runCommand(fake, [
      "loop",
      "implement password login",
      "--check",
      "--staged",
      "--no-semantic",
    ]);
    expect(fake.prepareTask).toHaveBeenCalledWith("implement password login", {
      check: true,
      repoPath: process.cwd(),
      scope: "staged",
      semantic: false,
    });
    const rendered = formatResult(out);
    expect(rendered).toContain("Drift check");
    expect(rendered).toContain("catch event id: 42");
    expect(rendered).toContain("marrow accept q_9");
    expect(rendered).toContain("src/auth.ts");
  });

  it("truth returns a maintenance brief with next human actions", async () => {
    const fake = {
      maintainTruth: vi.fn().mockResolvedValue({
        sourceOfTruth: {
          decidedGoals: [
            {
              id: "goal_1",
              kind: "goal",
              title: "Make onboarding self serve",
              status: "decided",
              confidence: { value: 1, source: "human" },
              provenance: [
                {
                  evidenceId: "ev_1",
                  source: "standups/goals.md",
                  start: 0,
                  end: 10,
                  spanText: "goal text",
                },
              ],
            },
          ],
          decidedDecisions: [],
        },
        openProposedGoals: [],
        contestedFacts: [],
        gapQuestions: [],
        pendingCatches: [],
        connectorHealth: [{ name: "slack", kind: "slack", enabled: true, status: "never" }],
        nextActions: ["Run `marrow sync slack` or check the connector."],
      }),
    } as unknown as Marrow;

    const out = await runCommand(fake, ["truth"]);
    expect(fake.maintainTruth).toHaveBeenCalledOnce();
    const rendered = formatResult(out);
    expect(rendered).toContain("Product truth maintenance");
    expect(rendered).toContain("Make onboarding self serve");
    expect(rendered).toContain("Connector health");
    expect(rendered).toContain("Next actions");
  });
});

describe("cli: connectors + observability", () => {
  beforeEach(async () => {
    process.env["MARROW_SECRET_KEY"] = process.env["MARROW_SECRET_KEY"] ?? "test-cli-secret-key";
    await admin.query(
      "truncate run, connector_config, connector_state, evidence restart identity cascade",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("configures a connector, lists it with state, toggles and removes it", async () => {
    const added = (await runCommand(core, [
      "connectors",
      "add",
      "slack",
      "--name",
      "slack",
      "--secret",
      "xoxb-token",
      "--settings",
      '{"channelIds":["C1"]}',
    ])) as { connector: { name: string; hasSecret: boolean; enabled: boolean } };
    expect(added.connector.name).toBe("slack");
    expect(added.connector.hasSecret).toBe(true);

    const list = (await runCommand(core, ["connectors"])) as {
      connectors: { name: string; state: unknown }[];
    };
    expect(list.connectors.length).toBe(1);
    expect(list.connectors[0]?.name).toBe("slack");
    expect(list.connectors[0]?.state).toBeNull();
    // the formatted output shows the connector and that it has not synced
    expect(formatResult(list)).toMatch(/slack \(slack\)/);

    await runCommand(core, ["connectors", "disable", "slack"]);
    const afterDisable = (await runCommand(core, ["connectors"])) as {
      connectors: { enabled: boolean }[];
    };
    expect(afterDisable.connectors[0]?.enabled).toBe(false);

    await runCommand(core, ["connectors", "rm", "slack"]);
    const empty = (await runCommand(core, ["connectors"])) as { connectors: unknown[] };
    expect(empty.connectors.length).toBe(0);
  });

  it("rejects an unknown connector kind", async () => {
    await expect(
      runCommand(core, ["connectors", "add", "myspace", "--name", "x", "--secret", "t"]),
    ).rejects.toThrow(/unknown connector kind/);
  });

  it("sync pulls connector drafts into append-only evidence and renders the result", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.includes("conversations.history")) {
        return new Response(
          JSON.stringify({
            ok: true,
            messages: [{ ts: "1780000000.000200", text: "we ship monday" }],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await runCommand(core, [
      "connectors",
      "add",
      "slack",
      "--name",
      "slack",
      "--secret",
      "xoxb-token",
      "--settings",
      '{"channelIds":["C1"]}',
    ]);

    const out = (await runCommand(core, ["sync", "slack"])) as {
      synced: { name: string; status: string; itemsIngested: number; itemsSkipped: number }[];
    };

    expect(out.synced).toHaveLength(1);
    expect(out.synced[0]).toMatchObject({
      name: "slack",
      status: "ok",
      itemsIngested: 1,
      itemsSkipped: 0,
    });
    expect(formatResult(out)).toContain("Synced slack: 1 new, 0 already seen");
    const stored = await core.searchEvidence("we ship monday");
    expect(stored[0]?.source).toBe("slack:C1:1780000000.000200");

    const all = (await runCommand(core, ["sync"])) as {
      synced: { name: string; status: string; itemsIngested: number; itemsSkipped: number }[];
    };
    expect(all.synced[0]).toMatchObject({
      name: "slack",
      status: "ok",
      itemsIngested: 0,
      itemsSkipped: 1,
    });
  });

  it("records runs for the pipeline and aggregates them with observe", async () => {
    // a distill (via add) records a distill run; a search records a search run.
    await core.ingestAndDistill({ text: transcript, source: "interviews/x.md" });
    await core.search("magic");

    const runs = (await runCommand(core, ["runs"])) as { runs: { kind: string }[] };
    expect(runs.runs.length).toBeGreaterThan(0);
    expect(runs.runs.some((r) => r.kind === "distill")).toBe(true);

    const distillOnly = (await runCommand(core, ["runs", "--kind", "distill"])) as {
      runs: { kind: string }[];
    };
    expect(distillOnly.runs.every((r) => r.kind === "distill")).toBe(true);

    const metrics = (await runCommand(core, ["observe"])) as { count: number; byKind: object };
    expect(metrics.count).toBeGreaterThan(0);
    expect(formatResult(metrics)).toMatch(/Runs:/);
  });
});
