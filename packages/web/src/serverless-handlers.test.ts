import { execFileSync } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { Store } from "@marrowhq/core";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";
const here = dirname(fileURLToPath(import.meta.url));
const coreMigrate = join(here, "..", "..", "core", "scripts", "migrate.mjs");

interface CapturedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  json(): unknown;
}

function req(method: string, url: string, body?: unknown): IncomingMessage {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const stream = Readable.from(chunks) as IncomingMessage & { method: string; url: string };
  stream.method = method;
  stream.url = url;
  return stream;
}

function res(): ServerResponse & CapturedResponse {
  const out = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: "",
    setHeader(key: string, value: string) {
      this.headers[key.toLowerCase()] = value;
    },
    end(body: string) {
      this.body = body;
    },
    json() {
      return JSON.parse(this.body) as unknown;
    },
  };
  return out as ServerResponse & CapturedResponse;
}

let store: Store;
let admin: pg.Pool;

beforeAll(async () => {
  process.env.DATABASE_URL = DATABASE_URL;
  execFileSync("node", [coreMigrate], { env: { ...process.env, DATABASE_URL }, stdio: "ignore" });
  store = new Store(DATABASE_URL);
  admin = new pg.Pool({ connectionString: DATABASE_URL });
});

afterAll(async () => {
  await admin.query(
    "truncate provenance, embedding, entity, decision, question, goal, connector_config, connector_state, evidence restart identity cascade",
  );
  const { closeServerlessForTests } = await import("../api/_core");
  await closeServerlessForTests();
  await store.close();
  await admin.end();
});

beforeEach(async () => {
  await admin.query(
    "truncate provenance, embedding, entity, decision, question, goal, connector_config, connector_state, evidence restart identity cascade",
  );
});

describe("serverless route handlers", () => {
  it("mirror the Node API routes for state, trace, evidence, connectors, ingest, and batch answer", async () => {
    const stateHandler = (await import("../api/state")).default;
    const traceHandler = (await import("../api/trace/[nodeId]")).default;
    const evidenceHandler = (await import("../api/evidence/recent")).default;
    const connectorsHandler = (await import("../api/connectors/index")).default;
    const ingestHandler = (await import("../api/ingest")).default;
    const answerBatchHandler = (await import("../api/answer-batch")).default;

    const text = "Magic links only. Serverless route parity stays cited.";
    const evidence = await store.insertEvidence({ text, source: "serverless/room.md" });
    const decision = await store.insertDecision({
      title: "Serverless parity keeps magic links",
      rationale: "Password login is out",
      constraint: true,
      status: "open",
      confidence: { value: 0.8, source: "model" },
      provenance: [{ evidenceId: evidence.id, start: 0, end: "Magic links only".length }],
    });
    const question = await store.insertQuestion({
      prompt: "Confirm serverless magic-link parity.",
      relatesTo: [decision.id],
      status: "open",
      confidence: { value: 0.7, source: "model" },
      provenance: decision.provenance,
    });
    await store.upsertConnectorConfig({
      name: "serverless-slack",
      kind: "slack",
      enabled: true,
      settings: { channelIds: ["C_SERVERLESS"] },
    });

    const ingestRes = res();
    await ingestHandler(
      req("POST", "/api/ingest", { text: "New serverless evidence", source: "serverless/new.md" }),
      ingestRes,
    );
    expect(ingestRes.statusCode).toBe(200);
    expect(ingestRes.json()).toMatchObject({ source: "serverless/new.md", chars: 23 });

    const stateRes = res();
    await stateHandler(req("GET", "/api/state"), stateRes);
    expect(stateRes.statusCode).toBe(200);
    expect(stateRes.json()).toMatchObject({
      readOnly: false,
      decisions: [expect.objectContaining({ id: decision.id, status: "open" })],
      questions: [expect.objectContaining({ id: question.id, status: "open" })],
    });

    const traceRes = res();
    await traceHandler(req("GET", `/api/trace/${decision.id}`), traceRes);
    expect(traceRes.statusCode).toBe(200);
    expect(traceRes.json()).toMatchObject({
      nodeId: decision.id,
      spans: [
        expect.objectContaining({ source: "serverless/room.md", spanText: "Magic links only" }),
      ],
    });

    const evidenceRes = res();
    await evidenceHandler(req("GET", "/api/evidence/recent?limit=1"), evidenceRes);
    expect(evidenceRes.statusCode).toBe(200);
    expect(evidenceRes.json()).toEqual([
      expect.objectContaining({ source: "serverless/new.md", preview: "New serverless evidence" }),
    ]);

    const connectorsRes = res();
    await connectorsHandler(req("GET", "/api/connectors"), connectorsRes);
    expect(connectorsRes.statusCode).toBe(200);
    expect(connectorsRes.json()).toEqual([
      expect.objectContaining({ name: "serverless-slack", lastStatus: "never", totalItems: 0 }),
    ]);

    const batchRes = res();
    await answerBatchHandler(
      req("POST", "/api/answer-batch", {
        answers: [{ questionId: question.id, text: "Confirmed by the serverless route." }],
      }),
      batchRes,
    );
    expect(batchRes.statusCode).toBe(200);
    expect(batchRes.json()).toMatchObject({
      promoted: [expect.objectContaining({ id: decision.id, status: "decided" })],
    });
  });
});

/** A request whose body is arbitrary bytes, not JSON.stringify of a value, so we
 *  can exercise the oversized-body and malformed-JSON paths. */
function rawReq(method: string, url: string, buf: Buffer): IncomingMessage {
  const stream = Readable.from([buf]) as IncomingMessage & { method: string; url: string };
  stream.method = method;
  stream.url = url;
  return stream;
}

describe("serverless error classification", () => {
  it("answers a typed 4xx instead of a raw 500 for client faults", async () => {
    const traceHandler = (await import("../api/trace/[nodeId]")).default;
    const answerHandler = (await import("../api/answer")).default;

    // an unknown trace id: core throws "not found", classified to 404 (not 500).
    const traceRes = res();
    await traceHandler(req("GET", "/api/trace/ent_does_not_exist"), traceRes);
    expect(traceRes.statusCode).toBe(404);

    // a wrong verb on a known route: 405 with the Allow header.
    const methodRes = res();
    await traceHandler(req("POST", "/api/trace/whatever"), methodRes);
    expect(methodRes.statusCode).toBe(405);

    // an oversized body: 413, never a 500.
    const bigRes = res();
    await answerHandler(rawReq("POST", "/api/answer", Buffer.alloc(1_000_001)), bigRes);
    expect(bigRes.statusCode).toBe(413);

    // a malformed JSON body: 400, never a 500.
    const badJsonRes = res();
    await answerHandler(rawReq("POST", "/api/answer", Buffer.from("not json{")), badJsonRes);
    expect(badJsonRes.statusCode).toBe(400);
  });
});
