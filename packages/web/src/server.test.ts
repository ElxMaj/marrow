import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer as createNodeServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { type AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type EmbeddingProvider,
  type EmbeddingResult,
  Marrow,
  type ModelProvider,
  Store,
} from "@marrowhq/core";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createApiServer } from "./api";
import { startWebServer } from "./server";

// This boots the real HTTP server (routing, body parsing, status codes, the SPA
// fallback) on an ephemeral port. api.test only calls the core-passthrough
// functions and never exercises the server itself.

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";
const here = dirname(fileURLToPath(import.meta.url));
const coreMigrate = join(here, "..", "..", "core", "scripts", "migrate.mjs");
const transcript = "Staff: we decided magic links, no shared passwords for the front desk.";

class FakeModel implements ModelProvider {
  readonly model = "fake-model";
  complete(): Promise<string> {
    return Promise.resolve(
      JSON.stringify({ entities: [{ name: "magic link auth", quote: "magic links" }] }),
    );
  }
}
class FakeEmbedding implements EmbeddingProvider {
  readonly model = "fake-emb";
  embed(texts: string[]): Promise<EmbeddingResult> {
    return Promise.resolve({ vectors: texts.map(() => [0, 0, 0, 0]), model: this.model, dim: 4 });
  }
}

async function getFreePort(): Promise<number> {
  const temp = createNodeServer();
  await new Promise<void>((resolve) => temp.listen(0, "127.0.0.1", resolve));
  const port = (temp.address() as AddressInfo).port;
  await new Promise<void>((resolve) => temp.close(() => resolve()));
  return port;
}

let store: Store;
let core: Marrow;
let admin: pg.Pool;
let server: Server;
let base: string;
let clientDir: string;

beforeAll(async () => {
  execFileSync("node", [coreMigrate], { env: { ...process.env, DATABASE_URL }, stdio: "ignore" });
  // the console endpoints encrypt connector secrets at rest; a key must be set.
  process.env.MARROW_SECRET_KEY ??= "test-console-key";
  store = new Store(DATABASE_URL);
  core = new Marrow(store, new FakeModel(), new FakeEmbedding());
  admin = new pg.Pool({ connectionString: DATABASE_URL });

  // a clientDir so the SPA fallback path can be exercised.
  clientDir = mkdtempSync(join(tmpdir(), "marrow-web-"));
  writeFileSync(join(clientDir, "index.html"), "<!doctype html><title>marrow</title>");
  writeFileSync(join(clientDir, "app.css"), "body { color: black; }");

  // the console endpoints (runs, metrics, connectors, evidence, ingest) read and
  // write through a Store directly, so wire one into the server.
  server = createApiServer(core, { clientDir, store });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await store.close();
  await admin.end();
});
afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await admin.query(
    "truncate provenance, embedding, entity, decision, question, goal restart identity cascade",
  );
});

describe("web api server", () => {
  it("GET /api/state returns the graph with status + provenance", async () => {
    await core.ingestAndDistill({ text: transcript, source: "interviews/x.md" });
    const res = await fetch(`${base}/api/state`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { questions: { status: string }[]; entities: unknown[] };
    expect(body.entities.length).toBeGreaterThan(0);
    expect(body.questions[0]?.status).toBeDefined();
  });

  it("POST /api/answer with a missing body is a 400, not a crash", async () => {
    const res = await fetch(`${base}/api/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "no question id" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/answer promotes the related node through core", async () => {
    await core.ingestAndDistill({ text: transcript, source: "interviews/x.md" });
    const state = (await (await fetch(`${base}/api/state`)).json()) as {
      questions: { id: string; relatesTo?: string[] }[];
    };
    const gap = state.questions.find((q) => (q.relatesTo ?? []).length === 1);
    if (!gap) throw new Error("expected a gap question");

    const res = await fetch(`${base}/api/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId: gap.id, text: "yes, magic links only" }),
    });
    expect(res.status).toBe(200);
    const node = await core.getNode((gap.relatesTo ?? [])[0] ?? "");
    expect(node?.status).toBe("decided");
  });

  it("POST /api/answer-batch validates shape and promotes several questions", async () => {
    const ev1 = await core.ingest({ text: "magic link auth needs work", source: "batch/a.md" });
    const ev2 = await core.ingest({ text: "payment retry logic needs work", source: "batch/b.md" });
    const entity1 = await core.proposeNode({
      kind: "entity",
      name: "magic link auth",
      provenance: [{ evidenceId: ev1, start: 0, end: 20 }],
      confidence: 0.7,
    });
    const entity2 = await core.proposeNode({
      kind: "entity",
      name: "payment retry logic",
      provenance: [{ evidenceId: ev2, start: 0, end: 20 }],
      confidence: 0.7,
    });
    const q1 = await core.proposeNode({
      kind: "question",
      prompt: "specify magic link auth",
      relatesTo: [entity1.id],
      provenance: [{ evidenceId: ev1, start: 0, end: 20 }],
      confidence: 0.6,
    });
    const q2 = await core.proposeNode({
      kind: "question",
      prompt: "specify payment retry logic",
      relatesTo: [entity2.id],
      provenance: [{ evidenceId: ev2, start: 0, end: 20 }],
      confidence: 0.6,
    });

    const invalid = await fetch(`${base}/api/answer-batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: [{ questionId: q1.id }] }),
    });
    expect(invalid.status).toBe(400);

    const res = await fetch(`${base}/api/answer-batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        answers: [
          { questionId: q1.id, text: "confirmed" },
          { questionId: q2.id, text: "confirmed" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { promoted: unknown[] };
    expect(body.promoted).toHaveLength(2);
    expect((await core.getOpenQuestions()).some((q) => q.id === q1.id || q.id === q2.id)).toBe(
      false,
    );
  });

  it("an unknown /api route is a 404", async () => {
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
  });

  it("rejects a malformed timestamp param with a fixed 400, never reflecting a DB error", async () => {
    const res = await fetch(`${base}/api/metrics?since=not-a-date`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("since must be an ISO-8601 timestamp");
    // the raw Postgres cast error (engine, column type, reflected input) never leaks.
    expect(JSON.stringify(body)).not.toMatch(/invalid input syntax|for type timestamp/i);
  });

  it("GET /api/runs with a non-positive or fractional limit falls back to the default, not a 500", async () => {
    for (const bad of ["-5", "0", "2.5"]) {
      const res = await fetch(`${base}/api/runs?limit=${bad}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(await res.json())).toBe(true);
    }
  });

  it("a non-api route serves the SPA index.html", async () => {
    const res = await fetch(`${base}/some/client/route`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/html/);
    expect(await res.text()).toMatch(/marrow/);
  });

  it("serves static assets and keeps traversal-looking paths inside the SPA", async () => {
    const asset = await fetch(`${base}/app.css`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toMatch(/css/);
    expect(await asset.text()).toContain("color: black");

    const traversal = await fetch(`${base}/%2e%2e/package.json`);
    expect(traversal.status).toBe(200);
    expect(traversal.headers.get("content-type")).toMatch(/html/);
    expect(await traversal.text()).toMatch(/marrow/);
  });

  it("caps JSON request bodies with a 413, not a 500", async () => {
    const res = await fetch(`${base}/api/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "x".repeat(1_000_001), source: "too-large.md" }),
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toMatch(/request body too large/);
  });

  it("answers client mistakes with typed 4xx, never a 500 with internals", async () => {
    // malformed JSON body -> 400 naming the problem
    const badJson = await fetch(`${base}/api/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(badJson.status).toBe(400);
    expect(((await badJson.json()) as { error: string }).error).toMatch(/not valid JSON/);

    // unknown API route -> JSON 404 envelope
    const unknown = await fetch(`${base}/api/definitely-not-a-route`);
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { error: string }).error).toBe("not found");

    // known route, wrong verb -> 405 with the Allow header
    const wrongVerb = await fetch(`${base}/api/state`, { method: "POST" });
    expect(wrongVerb.status).toBe(405);
    expect(wrongVerb.headers.get("allow")).toBe("GET");
    expect(((await wrongVerb.json()) as { error: string }).error).toMatch(/use GET/);

    // a missing id in core's voice -> 404, not 500
    const missing = await fetch(`${base}/api/trace/dec_does_not_exist`);
    expect(missing.status).toBe(404);

    // a trailing slash is the same route
    const slash = await fetch(`${base}/api/state/`);
    expect(slash.status).toBe(200);

    // HEAD reads as up with no body
    const head = await fetch(`${base}/api/state`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("a hostile page cannot write into the brain: cross-origin POSTs die, same-origin lives", async () => {
    const payload = { text: "csrf probe", source: "hostile.md" };
    // a browser on another site attaches its Origin: refused before any work.
    const hostile = await fetch(`${base}/api/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify(payload),
    });
    expect(hostile.status).toBe(403);
    expect(((await hostile.json()) as { error: string }).error).toMatch(/cross-origin/);

    // the classic no-preflight CSRF shape: an HTML form body. refused by type.
    const form = await fetch(`${base}/api/ingest`, {
      method: "POST",
      headers: { "content-type": "text/plain", origin: "https://evil.example" },
      body: "text=x&source=y",
    });
    expect(form.status).toBe(403);

    // same-origin (Origin matches Host) passes the gate.
    const host = new URL(base).host;
    const sameOrigin = await fetch(`${base}/api/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: `http://${host}` },
      body: JSON.stringify({ text: "same origin note", source: "console.md" }),
    });
    expect(sameOrigin.status).toBe(200);

    // curl-style requests carry no Origin at all and keep working, but a
    // body that is not JSON is refused by content type.
    const plainBody = await fetch(`${base}/api/ingest`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not json",
    });
    expect(plainBody.status).toBe(415);
  });

  it("responses carry the defensive headers", async () => {
    const api = await fetch(`${base}/api/state`);
    expect(api.headers.get("cache-control")).toBe("no-store");
    expect(api.headers.get("x-content-type-options")).toBe("nosniff");

    const html = await fetch(`${base}/`);
    expect(html.headers.get("x-frame-options")).toBe("DENY");
    expect(html.headers.get("x-content-type-options")).toBe("nosniff");
    expect(html.headers.get("content-security-policy")).toMatch(/default-src 'self'/);
  });

  it("startWebServer binds localhost by default and serves the SPA", async () => {
    const port = await getFreePort();
    const started = await startWebServer({ core, port, clientDir });
    try {
      expect(started.url).toBe(`http://localhost:${port}`);
      const addr = started.server.address() as AddressInfo;
      expect(addr.address).toBe("127.0.0.1");
      const res = await fetch(`${started.url}/client/route`);
      expect(res.status).toBe(200);
      expect(await res.text()).toMatch(/marrow/);
    } finally {
      await new Promise<void>((resolve) => started.server.close(() => resolve()));
    }
  });
});

// The console surfaces (observability, connectors, ingest) read and write the
// run trace and connector tables through a Store. These are still a thin window:
// every handler is a passthrough to a core method, no product logic in the web.
describe("web api console endpoints", () => {
  beforeEach(async () => {
    await admin.query("truncate run, connector_state, connector_config, evidence cascade");
  });

  it("GET /api/metrics aggregates the run trace", async () => {
    await store.recordRun({
      kind: "distill",
      status: "ok",
      model: "claude-opus-4-8",
      tokensIn: 1000,
      tokensOut: 200,
      costUsd: 0.03,
      latencyMs: 1200,
    });
    const res = await fetch(`${base}/api/metrics`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      count: number;
      totalCostUsd: number;
      p50LatencyMs: number;
      byKind: Record<string, unknown>;
    };
    expect(body.count).toBeGreaterThanOrEqual(1);
    expect(body.totalCostUsd).toBeGreaterThan(0);
    expect(body.byKind.distill).toBeDefined();
  });

  it("GET /api/runs lists runs and filters by kind", async () => {
    const run = await store.recordRun({ kind: "search", status: "ok", latencyMs: 40 });
    await store.recordRun({ kind: "distill", status: "ok", latencyMs: 2200 });

    const all = (await (await fetch(`${base}/api/runs`)).json()) as { id: string; kind: string }[];
    expect(all.length).toBeGreaterThanOrEqual(2);

    const search = (await (await fetch(`${base}/api/runs?kind=search`)).json()) as {
      id: string;
      kind: string;
    }[];
    expect(search.every((r) => r.kind === "search")).toBe(true);
    expect(search.some((r) => r.id === run.id)).toBe(true);
  });

  it("GET /api/runs/:id returns one run, 404 when unknown", async () => {
    const run = await store.recordRun({ kind: "drift", status: "ok", latencyMs: 3000 });
    const ok = await fetch(`${base}/api/runs/${run.id}`);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { id: string }).id).toBe(run.id);

    const miss = await fetch(`${base}/api/runs/run_does_not_exist`);
    expect(miss.status).toBe(404);
  });

  it("POST /api/connectors upserts and encrypts the secret, GET merges state", async () => {
    const post = await fetch(`${base}/api/connectors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "slack",
        kind: "slack",
        enabled: true,
        settings: { channelIds: ["C_PROD"] },
        secret: "xoxb-secret",
      }),
    });
    expect(post.status).toBe(200);
    const created = (await post.json()) as { name: string; hasSecret: boolean };
    expect(created.hasSecret).toBe(true);

    // the secret is never stored in plaintext settings.
    const cipher = await store.getConnectorSecretCipher("slack");
    expect(cipher).toBeDefined();
    expect(cipher).not.toContain("xoxb-secret");

    const list = (await (await fetch(`${base}/api/connectors`)).json()) as {
      name: string;
      kind: string;
      hasSecret: boolean;
      lastStatus: string;
      totalItems: number;
    }[];
    const slack = list.find((c) => c.name === "slack");
    expect(slack?.hasSecret).toBe(true);
    expect(slack?.lastStatus).toBe("never");
    expect(slack?.totalItems).toBe(0);
  });

  it("POST /api/connectors/:name/enable toggles the connector", async () => {
    await fetch(`${base}/api/connectors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "github", kind: "github", enabled: true, settings: {} }),
    });
    const res = await fetch(`${base}/api/connectors/github/enable`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    const cfg = await store.getConnectorConfig("github");
    expect(cfg?.enabled).toBe(false);
  });

  it("POST /api/connectors/:name/sync is a 404 for an unconfigured connector", async () => {
    const res = await fetch(`${base}/api/connectors/nope/sync`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("POST /api/connectors/:name/sync runs a configured connector and records evidence", async () => {
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = input.toString();
      if (url.startsWith("https://slack.com/api/conversations.history")) {
        return new Response(
          JSON.stringify({
            ok: true,
            messages: [{ ts: "1780000000.000200", text: "we ship monday" }],
          }),
          { status: 200 },
        );
      }
      if (url.startsWith("https://slack.com/api/")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return realFetch(input, init);
    });
    await fetch(`${base}/api/connectors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "slack",
        kind: "slack",
        enabled: true,
        settings: { channelIds: ["C1"] },
        secret: "xoxb-token",
      }),
    });

    const res = await fetch(`${base}/api/connectors/slack/sync`, { method: "POST" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      name: string;
      status: string;
      itemsIngested: number;
      itemsSkipped: number;
    };
    expect(body).toMatchObject({
      name: "slack",
      status: "ok",
      itemsIngested: 1,
      itemsSkipped: 0,
    });
    const stored = await core.searchEvidence("we ship monday");
    expect(stored[0]?.source).toBe("slack:C1:1780000000.000200");
  });

  it("POST /api/ingest appends evidence, GET /api/evidence/recent shows it", async () => {
    const res = await fetch(`${base}/api/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "a note dropped into the brain", source: "manual/paste.md" }),
    });
    expect(res.status).toBe(200);
    const ev = (await res.json()) as { id: string };
    expect(ev.id.startsWith("ev_")).toBe(true);

    const recent = (await (await fetch(`${base}/api/evidence/recent`)).json()) as {
      source: string;
    }[];
    expect(recent.some((e) => e.source === "manual/paste.md")).toBe(true);
  });

  it("a read-only demo refuses the write endpoints with a 403", async () => {
    process.env.MARROW_READ_ONLY = "1";
    try {
      const ingest = await fetch(`${base}/api/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "x", source: "y" }),
      });
      expect(ingest.status).toBe(403);
      const conn = await fetch(`${base}/api/connectors`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "slack", kind: "slack", enabled: true, settings: {} }),
      });
      expect(conn.status).toBe(403);
      const goal = await fetch(`${base}/api/goals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "ship faster", goalType: "product" }),
      });
      expect(goal.status).toBe(403);
      const batch = await fetch(`${base}/api/answer-batch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers: [] }),
      });
      expect(batch.status).toBe(403);
      const sync = await fetch(`${base}/api/connectors/nope/sync`, { method: "POST" });
      expect(sync.status).toBe(403);
      const catchAction = await fetch(`${base}/api/catches/nope/dismiss`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "noise" }),
      });
      expect(catchAction.status).toBe(403);
      // reads stay open in a read-only demo: the user can still look.
      expect((await fetch(`${base}/api/metrics`)).status).toBe(200);
      expect((await fetch(`${base}/api/goals`)).status).toBe(200);
    } finally {
      delete process.env.MARROW_READ_ONLY;
    }
  });

  describe("web api catches endpoints", () => {
    beforeEach(async () => {
      await admin.query("truncate catch_events restart identity cascade");
    });

    it("GET /api/catches lists drift catches", async () => {
      // create evidence first for provenance
      const evidence = await store.insertEvidence({
        text: "we decided to use magic links, no passwords for authentication",
        source: "test.md",
      });

      // create a decided decision via propose and answer
      const decision = await core.proposeNode({
        kind: "decision",
        title: "auth uses magic links, no passwords",
        rationale: "passwords are a security burden",
        provenance: [{ evidenceId: evidence.id, start: 0, end: 30 }],
        confidence: 0.75,
      });
      const question = await core.proposeNode({
        kind: "question",
        prompt: "confirm magic link auth",
        relatesTo: [decision.id],
        provenance: [{ evidenceId: evidence.id, start: 0, end: 30 }],
        confidence: 0.7,
      });
      await core.answer(question.id, "confirmed", { decide: decision.id });

      const decided = await core.getNode(decision.id);
      if (!decided || decided.status !== "decided") throw new Error("expected a decided decision");

      // create a real drift catch using driftScan
      const result = await core.driftScan("demo-repo", {
        hunks: [
          {
            path: "src/auth/password.ts",
            lineStart: 10,
            lineEnd: 15,
            oldLines: "",
            hunkHeader: "@@ -10,0 +10,5 @@",
            newLines: "function hashPassword(pwd) { return bcrypt.hash(pwd); }",
          },
        ],
        semantic: false,
      });

      if (result.created.length === 0) throw new Error("expected a drift catch");
      const driftQuestion = result.created[0];
      if (!driftQuestion) throw new Error("expected drift question");

      const res = await fetch(`${base}/api/catches`);
      expect(res.status).toBe(200);
      const catches = (await res.json()) as { id: string; decisionId: string }[];
      expect(catches.length).toBeGreaterThan(0);
      expect(catches[0]?.decisionId).toBe(decision.id);
    });

    it("GET /api/catches treats drift questions answered in Questions as acted on", async () => {
      const evidence = await store.insertEvidence({
        text: "auth uses magic links, no passwords",
        source: "test.md",
      });
      const decision = await core.proposeNode({
        kind: "decision",
        title: "auth uses magic links, no passwords",
        rationale: "passwords are a security burden",
        provenance: [{ evidenceId: evidence.id, start: 0, end: 30 }],
        confidence: 0.75,
      });
      const confirm = await core.proposeNode({
        kind: "question",
        prompt: "confirm magic link auth",
        relatesTo: [decision.id],
        provenance: [{ evidenceId: evidence.id, start: 0, end: 30 }],
        confidence: 0.7,
      });
      await core.answer(confirm.id, "confirmed", { decide: decision.id });

      const result = await core.driftScan("demo-repo", {
        hunks: [
          {
            path: "src/auth/password.ts",
            lineStart: 10,
            lineEnd: 15,
            oldLines: "",
            hunkHeader: "@@ -10,0 +10,5 @@",
            newLines: "function hashPassword(pwd) { return bcrypt.hash(pwd); }",
          },
        ],
        semantic: false,
      });
      const driftQuestion = result.created[0];
      if (!driftQuestion) throw new Error("expected drift question");

      await core.answer(driftQuestion.id, "removed the password code");

      const res = await fetch(`${base}/api/catches`);
      expect(res.status).toBe(200);
      const catches = (await res.json()) as { id: string; status: string }[];
      expect(catches.find((c) => c.id === driftQuestion.id)?.status).toBe("acted-on");
    });

    it("GET /api/catches/metrics returns catch metrics", async () => {
      const res = await fetch(`${base}/api/catches/metrics`);
      expect(res.status).toBe(200);
      const metrics = (await res.json()) as {
        surfaced: number;
        actedOn: number;
        dismissed: number;
        precision: number;
        dismissRate: number;
      };
      expect(typeof metrics.surfaced).toBe("number");
      expect(typeof metrics.actedOn).toBe("number");
    });

    it("POST /api/catches/:id/accept accepts a drift catch", async () => {
      // create evidence first
      const evidence = await store.insertEvidence({
        text: "auth uses magic links, no passwords",
        source: "test.md",
      });

      // create a decided decision via propose and answer
      const decision = await core.proposeNode({
        kind: "decision",
        title: "auth uses magic links, no passwords",
        rationale: "passwords are a security burden",
        provenance: [{ evidenceId: evidence.id, start: 0, end: 30 }],
        confidence: 0.75,
      });
      const question = await core.proposeNode({
        kind: "question",
        prompt: "confirm magic link auth",
        relatesTo: [decision.id],
        provenance: [{ evidenceId: evidence.id, start: 0, end: 30 }],
        confidence: 0.7,
      });
      await core.answer(question.id, "confirmed", { decide: decision.id });

      const decided = await core.getNode(decision.id);
      if (!decided || decided.status !== "decided") throw new Error("expected decided");

      const result = await core.driftScan("demo-repo", {
        hunks: [
          {
            path: "src/auth/password.ts",
            lineStart: 12,
            lineEnd: 16,
            oldLines: "",
            hunkHeader: "@@ -12,0 +12,4 @@",
            newLines: "function hashPassword(p) { return bcrypt.hash(p); }",
          },
        ],
        semantic: false,
      });

      if (result.created.length === 0) throw new Error("expected a drift catch");
      const first = result.created[0];
      if (!first) throw new Error("expected first catch");
      const questionId = first.id;

      const res = await fetch(`${base}/api/catches/${encodeURIComponent(questionId)}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolution: "fixed: removed password logic" }),
      });
      expect(res.status).toBe(200);

      const updated = await store.getQuestion(questionId);
      expect(updated?.status).toBe("decided");
    });

    it("POST /api/catches/:id/accept requires a resolution", async () => {
      const res = await fetch(`${base}/api/catches/some-question/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/resolution is required/);
    });

    it("POST /api/catches/:id/dismiss dismisses a drift catch", async () => {
      const evidence = await store.insertEvidence({
        text: "no passwords, magic links only",
        source: "test.md",
      });

      const decision = await core.proposeNode({
        kind: "decision",
        title: "no passwords, magic links only",
        rationale: "passwords are deprecated",
        provenance: [{ evidenceId: evidence.id, start: 0, end: 25 }],
        confidence: 0.75,
      });
      const question = await core.proposeNode({
        kind: "question",
        prompt: "confirm no passwords",
        relatesTo: [decision.id],
        provenance: [{ evidenceId: evidence.id, start: 0, end: 25 }],
        confidence: 0.7,
      });
      await core.answer(question.id, "confirmed", { decide: decision.id });

      const decided = await core.getNode(decision.id);
      if (!decided || decided.status !== "decided") throw new Error("expected decided");

      const result = await core.driftScan("demo-repo", {
        hunks: [
          {
            path: "x.ts",
            lineStart: 1,
            lineEnd: 3,
            oldLines: "",
            hunkHeader: "@@ -1,0 +1,1 @@",
            newLines: "password",
          },
        ],
        semantic: false,
      });

      if (result.created.length === 0) throw new Error("expected a drift catch");
      const first = result.created[0];
      if (!first) throw new Error("expected first catch");
      const questionId = first.id;

      const res = await fetch(`${base}/api/catches/${encodeURIComponent(questionId)}/dismiss`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "false positive" }),
      });
      expect(res.status).toBe(200);

      const updated = await store.getQuestion(questionId);
      expect(updated?.status).toBe("dismissed");
    });

    it("POST /api/catches/:id/dismiss requires a reason", async () => {
      const res = await fetch(`${base}/api/catches/some-question/dismiss`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/reason is required/);
    });
  });

  // Goals are the headline space: the product team authors goals (POST, a write
  // gated by read-only), the agent proposes goals from the room, and both read
  // back through GET with status + provenance. The endpoint is a thin window: GET
  // reads the Store, POST drives core.authorGoal, no product logic in the web.
  describe("web api goals endpoints", () => {
    beforeEach(async () => {
      await admin.query("truncate provenance, embedding, entity, decision, question, goal cascade");
    });

    it("POST /api/goals authors a decided, human goal; GET /api/goals reads it back", async () => {
      const post = await fetch(`${base}/api/goals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "users can restore deleted records for 30 days",
          description: "soft delete with a visible recovery window",
          goalType: "user",
        }),
      });
      expect(post.status).toBe(200);
      const created = (await post.json()) as {
        id: string;
        status: string;
        confidence: { value: number; source: string };
        provenance: unknown[];
      };
      expect(created.id.startsWith("goal_")).toBe(true);
      expect(created.status).toBe("decided");
      expect(created.confidence).toEqual({ value: 1, source: "human" });
      expect(created.provenance.length).toBeGreaterThan(0);

      // a proposed (open, model) goal straight through core shows up too.
      const ev = await core.ingest({ text: "SOC2 before enterprise sales", source: "x" });
      await core.proposeNode({
        kind: "goal",
        title: "reach SOC2 compliance",
        goalType: "product",
        provenance: [{ evidenceId: ev, start: 0, end: 4 }],
        confidence: 0.5,
      });

      const res = await fetch(`${base}/api/goals`);
      expect(res.status).toBe(200);
      const goals = (await res.json()) as {
        title: string;
        status: string;
        goalType: string;
        confidence: { source: string };
        provenance: unknown[];
      }[];
      const authored = goals.find((g) => g.title.startsWith("users can restore"));
      expect(authored?.status).toBe("decided");
      expect(authored?.confidence.source).toBe("human");
      expect(authored?.provenance.length ?? 0).toBeGreaterThan(0);
      const proposed = goals.find((g) => g.title === "reach SOC2 compliance");
      expect(proposed?.status).toBe("open");
      expect(proposed?.goalType).toBe("product");
    });

    it("POST /api/goals without a title or a valid goalType is a 400", async () => {
      const noTitle = await fetch(`${base}/api/goals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goalType: "product" }),
      });
      expect(noTitle.status).toBe(400);
      const badType = await fetch(`${base}/api/goals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "x", goalType: "nonsense" }),
      });
      expect(badType.status).toBe(400);
    });

    it("GET /api/goals?goalType= filters by goal type", async () => {
      await fetch(`${base}/api/goals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "a product goal", goalType: "product" }),
      });
      await fetch(`${base}/api/goals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "a user goal", goalType: "user" }),
      });
      const res = await fetch(`${base}/api/goals?goalType=user`);
      const goals = (await res.json()) as { goalType: string }[];
      expect(goals.length).toBeGreaterThan(0);
      expect(goals.every((g) => g.goalType === "user")).toBe(true);
    });

    it("the ingest response tells the console what to do next", async () => {
      // capture returns canDistill so the Ingest view can name the exact next
      // command (distill now, or set a model key first) instead of leaving the
      // user wondering why no facts appeared.
      const res = await fetch(`${base}/api/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "a standup note worth distilling", source: "standups/x.md" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id?: string; canDistill?: boolean };
      expect(typeof body.id).toBe("string");
      // this test core is wired with a model + embedding, so distill is ready.
      expect(body.canDistill).toBe(true);
    });
  });
});
