import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Marrow } from "./marrow.js";
import { Store } from "./store.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";
const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "..", "fixtures", "onboard-repo");

let store: Store;
let core: Marrow;
let admin: pg.Pool;

async function snapshot(dir: string): Promise<string> {
  const parts: string[] = [];
  async function walk(d: string): Promise<void> {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) await walk(p);
      else parts.push(`${p}::${await readFile(p, "utf8")}`);
    }
  }
  await walk(dir);
  return parts.sort().join("\n");
}

beforeAll(() => {
  execFileSync("node", [join(here, "..", "scripts", "migrate.mjs")], {
    env: { ...process.env, DATABASE_URL },
    stdio: "ignore",
  });
  store = new Store(DATABASE_URL);
  // no providers: the scan proposes and asks, it never distills.
  core = new Marrow(store);
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

describe("onboarding scan", () => {
  it("never creates a decided node and never writes to the repo", async () => {
    const before = await snapshot(fixture);
    const result = await core.onboardingScan(fixture);
    expect(await snapshot(fixture)).toBe(before); // the repo is untouched
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.nodes.every((n) => n.status !== "decided")).toBe(true);
    expect(result.questions.length).toBeGreaterThan(0); // it asks
    expect(result.questions.every((q) => q.status === "open")).toBe(true);
  });

  it("marks scanned entities as low-confidence repo-sourced hints", async () => {
    const result = await core.onboardingScan(fixture);
    const entity = result.nodes[0];
    if (!entity) throw new Error("expected at least one entity");
    expect(entity.confidence.source).toBe("model");
    expect(entity.confidence.value).toBeLessThan(0.5);
    const t = await core.traceToSource(entity.id);
    expect(t.source?.startsWith("repo:")).toBe(true); // distinct from room sources
  });

  it("finds integrations from package.json and modules from source dirs", async () => {
    const result = await core.onboardingScan(fixture);
    const names = result.nodes.flatMap((n) => (n.kind === "entity" ? [n.name] : []));
    expect(names).toEqual(expect.arrayContaining(["stripe", "pg", "auth", "billing"]));
  });
});
