import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Marrow } from "./marrow.js";
import { type VisionProvider } from "./providers/types.js";
import { Store } from "./store.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";
const here = dirname(fileURLToPath(import.meta.url));

class FakeVision implements VisionProvider {
  readonly model = "fake-vision";
  describeImage(): Promise<string> {
    return Promise.resolve(
      "Whiteboard: magic links only, no shared passwords. Re-auth between shifts stays open.",
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

describe("vision adapter", () => {
  it("turns an image into append-only evidence text via the provider", async () => {
    const core = new Marrow(store, undefined, undefined, undefined, new FakeVision());
    const id = await core.ingestImage(new Uint8Array([1, 2, 3]), "whiteboards/kickoff.jpg");
    const ev = await core.getEvidence(id);
    expect(ev?.text.length).toBeGreaterThan(0);
    expect(ev?.text).toContain("magic links");
    // @ts-expect-error there is no delete path for evidence on the facade
    expect(core.deleteEvidence).toBeUndefined();
  });

  it("spans into the produced text resolve like any evidence", async () => {
    const core = new Marrow(store, undefined, undefined, undefined, new FakeVision());
    const id = await core.ingestImage(new Uint8Array([1]), "whiteboards/x.jpg");
    const ev = await core.getEvidence(id);
    expect(ev?.text.slice(0, 10)).toBe("Whiteboard");
  });

  it("with no vision provider, image ingest fails loud and text ingest still works", async () => {
    const core = new Marrow(store);
    await expect(core.ingestImage(new Uint8Array([1]), "x.jpg")).rejects.toThrow(
      /vision provider/i,
    );
    const id = await core.ingest({ text: "still works", source: "y" });
    expect(id).toMatch(/^ev_/);
  });
});
