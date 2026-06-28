import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Marrow } from "./marrow.js";
import {
  type EmbeddingProvider,
  type EmbeddingResult,
  type ModelProvider,
} from "./providers/types.js";
import { DISTILL_QUEUE, Queue } from "./queue.js";
import { Store } from "./store.js";
import { Worker } from "./worker.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";
const here = dirname(fileURLToPath(import.meta.url));
const transcript = "we decided magic links, no shared passwords at the front desk";

class FakeModel implements ModelProvider {
  readonly model = "fake-model";
  constructor(private readonly text: string) {}
  complete(): Promise<string> {
    const phrase = "magic links";
    const start = this.text.indexOf(phrase);
    return Promise.resolve(
      JSON.stringify({
        decisions: [
          {
            title: "magic links",
            rationale: "no shared passwords",
            start,
            end: start + phrase.length,
          },
        ],
      }),
    );
  }
}

class FakeEmbedding implements EmbeddingProvider {
  readonly model = "fake-emb";
  embed(texts: string[]): Promise<EmbeddingResult> {
    return Promise.resolve({ vectors: texts.map(() => [0, 0, 0, 0]), model: this.model, dim: 4 });
  }
}

let store: Store;
let queue: Queue;
let core: Marrow;
let worker: Worker;
let admin: pg.Pool;

beforeAll(async () => {
  execFileSync("node", [join(here, "..", "scripts", "migrate.mjs")], {
    env: { ...process.env, DATABASE_URL },
    stdio: "ignore",
  });
  store = new Store(DATABASE_URL);
  queue = new Queue(DATABASE_URL);
  await queue.start();
  core = new Marrow(store, new FakeModel(transcript), new FakeEmbedding(), queue);
  worker = new Worker(queue, core);
  admin = new pg.Pool({ connectionString: DATABASE_URL });
});

afterAll(async () => {
  await queue.stop();
  await store.close();
  await admin.end();
});

beforeEach(async () => {
  await admin.query(
    "truncate provenance, embedding, entity, decision, question, goal restart identity cascade",
  );
  await admin.query("truncate pgboss.job").catch(() => {
    /* fresh db has no jobs yet */
  });
});

describe("job queue", () => {
  it("ingest enqueues distill and the worker produces nodes", async () => {
    const id = await core.ingest({ text: transcript, source: "interviews/x.md" });
    // ingestion returns fast: nothing is distilled yet.
    expect(await core.getNodesForEvidence(id)).toHaveLength(0);

    const handled = await worker.runOnce();
    expect(handled).toBe(true);

    const nodes = await core.getNodesForEvidence(id);
    expect(nodes.length).toBeGreaterThan(0);
  });

  it("runUntilEmpty drains available jobs and returns the processed count", async () => {
    await core.ingest({ text: transcript, source: "interviews/a.md" });
    await core.ingest({ text: transcript, source: "interviews/b.md" });

    expect(await worker.runUntilEmpty()).toBe(2);
    expect(await worker.runOnce()).toBe(false);
  });

  it("a failed job surfaces in a failed state, it never silently drops", async () => {
    const jobId = await queue.enqueueDistill("ev_does_not_exist", { retryLimit: 0 });
    expect(await worker.runOnce()).toBe(true);

    const state = await queue.getState(jobId);
    expect(state.failed).toBe(true);
  });

  it("a transient failure retries instead of vanishing", async () => {
    const jobId = await queue.enqueueDistill("ev_does_not_exist", { retryLimit: 2 });
    await worker.runOnce(); // fails once, retries remain

    const state = await queue.getState(jobId);
    expect(state.state).not.toBe("not_found"); // it is still tracked
    expect(state.failed).toBe(false); // not yet exhausted
  });

  it("enqueues distill jobs with default retry backoff and fails loud when no id is returned", async () => {
    type SendCall = { queue: string; data: unknown; options: unknown };
    const calls: SendCall[] = [];
    const queueWithStub = new Queue(DATABASE_URL);
    (
      queueWithStub as unknown as {
        boss: {
          send: (queue: string, data: unknown, options: unknown) => Promise<string | null>;
        };
      }
    ).boss = {
      send: async (queueName, data, options) => {
        calls.push({ queue: queueName, data, options });
        return calls.length === 1 ? "job_123" : null;
      },
    };

    await expect(queueWithStub.enqueueDistill("ev_1")).resolves.toBe("job_123");
    expect(calls[0]).toEqual({
      queue: DISTILL_QUEUE,
      data: { evidenceId: "ev_1" },
      options: { retryLimit: 3, retryBackoff: true },
    });

    await expect(queueWithStub.enqueueDistill("ev_2")).rejects.toThrow(
      "queue: failed to enqueue distill job",
    );
  });
});
