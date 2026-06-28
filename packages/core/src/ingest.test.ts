import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Marrow } from "./marrow.js";
import { Store } from "./store.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";
const here = dirname(fileURLToPath(import.meta.url));

let core: Marrow;
let store: Store;
let admin: pg.Pool;

beforeAll(() => {
  execFileSync("node", [join(here, "..", "scripts", "migrate.mjs")], {
    env: { ...process.env, DATABASE_URL },
    stdio: "ignore",
  });
  store = new Store(DATABASE_URL);
  core = new Marrow(store);
  admin = new pg.Pool({ connectionString: DATABASE_URL });
});

afterAll(async () => {
  await store.close();
  await admin.end();
});

beforeEach(async () => {
  // evidence is append only even here, so it is never truncated.
  await admin.query(
    "truncate provenance, embedding, entity, decision, question, goal restart identity cascade",
  );
});

describe("ingestion", () => {
  it("stores evidence verbatim and spans are addressable", async () => {
    const text = "we share one login at the desk, the password ends up on a post-it";
    const id = await core.ingest({ text, source: "interviews/pfc-gdynia.md" });
    const ev = await core.getEvidence(id);
    expect(ev?.text).toBe(text);
    // a span addresses the same characters a citation would later point at.
    expect(ev?.text.slice(0, 30)).toBe("we share one login at the desk");
  });

  it("recovers any substring by span, byte for byte", async () => {
    const text = "magic links only, no shared passwords";
    const id = await core.ingest({ text, source: "x" });
    const ev = await core.getEvidence(id);
    expect(ev?.text.slice(0, 16)).toBe("magic links only");
    expect(ev?.text.slice(18)).toBe("no shared passwords");
  });

  it("offers no path to edit or delete evidence", () => {
    // @ts-expect-error ingestion is the only writer; there is no edit path
    expect(core.editEvidence).toBeUndefined();
    // @ts-expect-error there is no delete path
    expect(core.deleteEvidence).toBeUndefined();
  });

  it("does not dedupe raw: the same content twice makes two evidence rows", async () => {
    const text = "the same standup note";
    const a = await core.ingest({ text, source: "standups/2026-06-05.md" });
    const b = await core.ingest({ text, source: "standups/2026-06-05.md" });
    expect(a).not.toBe(b);
    expect((await core.getEvidence(a))?.text).toBe(text);
    expect((await core.getEvidence(b))?.text).toBe(text);
  });
});
