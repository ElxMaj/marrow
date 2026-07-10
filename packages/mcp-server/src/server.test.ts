import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type EmbeddingProvider,
  type EmbeddingResult,
  Marrow,
  type ModelProvider,
  Store,
} from "@marrowhq/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createServer } from "./server.js";

// This exercises the actual MCP wire envelope through the SDK transport, the one
// thing that must be spec-correct for Claude Code to connect. tools.test.ts only
// calls handlers directly and never sees the content/isError wrapping.

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";
const here = dirname(fileURLToPath(import.meta.url));
const coreMigrate = join(here, "..", "..", "core", "scripts", "migrate.mjs");

class FakeEmbedding implements EmbeddingProvider {
  readonly model = "fake-emb";
  embed(texts: string[]): Promise<EmbeddingResult> {
    return Promise.resolve({ vectors: texts.map(() => [0, 0, 0, 0]), model: this.model, dim: 4 });
  }
}
const fakeModel: ModelProvider = { model: "fake", complete: () => Promise.resolve("{}") };

interface CallResult {
  content: { type: string; text?: string }[];
  isError?: boolean;
}

let store: Store;
let admin: pg.Pool;
let client: Client;
let core: Marrow;

/** Seed a decided fact directly (the human-promoted end state), so a drift scan
 *  has something to diverge from without running the whole loop. */
async function seedDecided(title: string): Promise<string> {
  const ev = await store.insertEvidence({ text: title, source: "interviews/x.md" });
  const decision = await store.insertDecision({
    title,
    rationale: "",
    constraint: false,
    status: "decided",
    confidence: { value: 1, source: "human" },
    provenance: [{ evidenceId: ev.id, start: 0, end: Math.min(10, title.length) }],
  });
  return decision.id;
}

beforeAll(async () => {
  execFileSync("node", [coreMigrate], { env: { ...process.env, DATABASE_URL }, stdio: "ignore" });
  store = new Store(DATABASE_URL);
  admin = new pg.Pool({ connectionString: DATABASE_URL });
  core = new Marrow(store, fakeModel, new FakeEmbedding());

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer(core).connect(serverTransport);
  client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await store.close();
  await admin.end();
});

beforeEach(async () => {
  await admin.query(
    "truncate catch_events, provenance, embedding, entity, decision, question, goal restart identity cascade",
  );
});

describe("mcp server (over the SDK transport)", () => {
  it("reports its real package version to the host, not a placeholder", () => {
    // this is what shows in an MCP inspector / `/mcp`; a 0.0.0 there reads as unfinished.
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
      version: string;
    };
    const advertised = client.getServerVersion();
    expect(advertised?.name).toBe("marrow");
    expect(advertised?.version).toBe(pkg.version);
    expect(advertised?.version).not.toBe("0.0.0");
  });

  it("ships agent instructions covering decided-vs-open and propose-not-decide", () => {
    // the SDK surfaces these to the model on connect; this is Marrow's whole point.
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toMatch(/decided/i);
    expect(instructions).toMatch(/propose/i);
    expect(instructions).toMatch(/trace_to_source/);
  });

  it("advertises exactly the task loop tools with input schemas", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      "search",
      "get_decisions",
      "get_goals",
      "get_open_questions",
      "get_entity",
      "trace_to_source",
      "prepare_task",
      "append_evidence",
      "propose_node",
      "check_drift",
      "maintain_truth",
      "accept_catch",
      "dismiss_catch",
    ]);
    for (const tool of tools) expect(tool.inputSchema).toBeDefined();
  });

  it("wraps a tool result as one text block of parseable JSON", async () => {
    const res = (await client.callTool({ name: "get_decisions", arguments: {} })) as CallResult;
    expect(res.isError).toBeFalsy();
    expect(res.content[0]?.type).toBe("text");
    const parsed = JSON.parse(res.content[0]?.text ?? "") as { decisions: unknown[] };
    expect(Array.isArray(parsed.decisions)).toBe(true);
  });

  it("returns isError for an unknown tool, not a crash", async () => {
    const res = (await client.callTool({ name: "no_such_tool", arguments: {} })) as CallResult;
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text ?? "").toMatch(/unknown tool/i);
  });

  it("returns a named, actionable validation error (not a raw zod blob)", async () => {
    // propose_node requires provenance + a per-kind field; this trips zod.
    const res = (await client.callTool({
      name: "propose_node",
      arguments: { kind: "decision" },
    })) as CallResult;
    expect(res.isError).toBe(true);
    expect(res.content[0]?.type).toBe("text");
    // one readable line naming the tool, not a JSON.stringify of zod issues.
    expect(res.content[0]?.text ?? "").toContain("Invalid arguments for propose_node:");
    expect(res.content[0]?.text ?? "").not.toMatch(/^\s*\[/);
  });

  // The code-time guardrail end to end: a coding agent that calls check_drift on
  // a repo whose code contradicts a decided fact gets back an open question,
  // never a silent overwrite. This is the through-line a RAG tool cannot offer.
  //
  // It runs against a throwaway git repo built in a temp dir, not a fixture
  // inside this repo: `git diff` is never scoped to a subdirectory, so pointing
  // check_drift at a path inside marrow would scan marrow's own working tree and
  // make the test depend on whatever is uncommitted at the time. An isolated
  // repo gives a deterministic, hermetic diff.
  it("check_drift flags code diverging from a decided fact as an open question", async () => {
    const decisionId = await seedDecided("magic links only, no passwords");
    const repo = mkdtempSync(join(tmpdir(), "marrow-drift-"));
    const git = (...args: string[]): void =>
      void execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    try {
      git("init");
      git("config", "user.email", "test@marrow.dev");
      git("config", "user.name", "test");
      const file = join(repo, "auth.ts");
      // a committed baseline with no drift, then an unstaged change that adds
      // password auth, contradicting the decided "magic links only" fact.
      writeFileSync(file, "export function login() {\n  return magicLink();\n}\n");
      git("add", "-A");
      git("commit", "-m", "baseline");
      writeFileSync(
        file,
        "export function login(password: string) {\n  const passwordHash = hash(password);\n  return passwordHash;\n}\n",
      );

      const res = (await client.callTool({
        name: "check_drift",
        // semantic:false uses deterministic keyword matching, the same path
        // core's own drift tests use with a stub model.
        arguments: { repoPath: repo, semantic: false },
      })) as CallResult;

      expect(res.isError).toBeFalsy();
      const parsed = JSON.parse(res.content[0]?.text ?? "") as {
        drift: { kind: string; status: string; relatesTo?: string[] }[];
      };
      expect(parsed.drift.length).toBeGreaterThan(0);
      expect(parsed.drift.every((n) => n.kind === "question" && n.status !== "decided")).toBe(true);
      expect(parsed.drift.some((q) => (q.relatesTo ?? []).includes(decisionId))).toBe(true);
      expect((await core.getNode(decisionId))?.status).toBe("decided"); // decided fact untouched
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
