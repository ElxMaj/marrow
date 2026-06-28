import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Marrow } from "./marrow.js";
import { type TranscriptionProvider } from "./providers/types.js";
import { Store } from "./store.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";
const here = dirname(fileURLToPath(import.meta.url));

class FakeTranscription implements TranscriptionProvider {
  readonly model = "fake-transcription";
  transcribe(): Promise<string> {
    return Promise.resolve(
      "Standup: we decided magic links, no shared passwords. Re-auth cadence stays open.",
    );
  }
}

let store: Store;
let admin: pg.Pool;

beforeAll(() => {
  execFileSync("node", [join(here, "..", "scripts", "migrate.mjs")], {
    env: { ...process.env, DATABASE_URL },
    stdio: "ignore",
  });
  store = new Store(DATABASE_URL);
  admin = new pg.Pool({ connectionString: DATABASE_URL });
});

afterAll(async () => {
  await store.close();
  await admin.end();
});

beforeEach(async () => {
  await admin.query(
    "truncate provenance, embedding, entity, decision, question, goal restart identity cascade",
  );
});

const withTranscription = (): Marrow =>
  new Marrow(store, undefined, undefined, undefined, undefined, new FakeTranscription());

describe("transcription adapter", () => {
  it("turns audio into append-only transcript evidence via the provider", async () => {
    const core = withTranscription();
    const id = await core.ingestAudio(new Uint8Array([1, 2, 3]), "standups/2026-06-05.m4a");
    const ev = await core.getEvidence(id);
    expect(ev?.text.length).toBeGreaterThan(0);
    expect(ev?.text).toContain("magic links");
  });

  it("spans into the transcript resolve like any evidence", async () => {
    const core = withTranscription();
    const id = await core.ingestAudio(new Uint8Array([1]), "standups/x.m4a");
    const ev = await core.getEvidence(id);
    expect(ev?.text.slice(0, 8)).toBe("Standup:");
  });

  it("with no transcription provider, audio ingest fails loud and text ingest still works", async () => {
    const core = new Marrow(store);
    await expect(core.ingestAudio(new Uint8Array([1]), "x.m4a")).rejects.toThrow(
      /transcription provider/i,
    );
    const id = await core.ingest({ text: "still works", source: "y" });
    expect(id).toMatch(/^ev_/);
  });
});
