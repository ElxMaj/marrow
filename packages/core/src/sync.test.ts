import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { type ConnectorSyncResult } from "@marrowhq/shared";

import { type Connector } from "./connectors/index.js";
import { encryptSecret } from "./crypto.js";
import { Marrow, type IngestInput } from "./marrow.js";
import { Store } from "./store.js";
import { CONNECTOR_KINDS, SyncEngine, buildConnector } from "./sync.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";
const here = dirname(fileURLToPath(import.meta.url));

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
    "truncate run, connector_state, connector_config, evidence, provenance, embedding, entity, decision, question, goal, catch_events restart identity cascade",
  );
});

class FakeConnector implements Connector {
  readonly name = "fake";
  readonly sinceCalls: Date[] = [];
  constructor(
    private readonly drafts: IngestInput[],
    private readonly failWith?: string,
  ) {}
  async fetchSince(since: Date): Promise<IngestInput[]> {
    this.sinceCalls.push(since);
    if (this.failWith) throw new Error(this.failWith);
    return this.drafts;
  }
}

const stamped = (source: string, timestamp: string): IngestInput => ({
  text: `evidence ${source}`,
  source,
  timestamp: new Date(timestamp),
});

const drafts: IngestInput[] = [
  { text: "we decided soft delete is recoverable for 30 days", source: "fake:1" },
  { text: "the editor must work offline", source: "fake:2" },
];

describe("SyncEngine.runConnectorInstance", () => {
  it("ingests new evidence, dedups on re-run, advances the cursor, records a run", async () => {
    const engine = new SyncEngine({ store });
    const connector = new FakeConnector(drafts);

    const first = await engine.runConnectorInstance("fake", connector);
    expect(first.status).toBe("ok");
    expect(first.itemsIngested).toBe(2);
    expect(first.itemsSkipped).toBe(0);
    expect(first.runId).toMatch(/^run_/);
    // synced evidence lands in the distill backlog for the scheduled drain.
    const pending = await store.undistilledEvidence(10_000);
    expect(pending.filter((row) => row.source.startsWith("fake:")).length).toBe(2);

    // evidence is append only and now present
    expect(await store.hasEvidenceSource("fake:1")).toBe(true);

    // cursor advanced and a connector_sync run was recorded
    const state = await store.getConnectorState("fake");
    expect(state?.lastStatus).toBe("ok");
    expect(state?.cursor).toBeDefined();
    expect(state?.totalItems).toBe(2);
    const runs = await store.listRuns({ kind: "connector_sync" });
    expect(runs.length).toBe(1);
    expect(runs[0]?.label).toBe("fake");
    expect(runs[0]?.outputSummary).toBe("2 ingested, 0 skipped");
    expect(runs[0]?.metadata).toEqual({ itemsIngested: 2, itemsSkipped: 0 });

    // second run sees the same sources and skips all of them (dedup)
    const second = await engine.runConnectorInstance("fake", new FakeConnector(drafts));
    expect(second.itemsIngested).toBe(0);
    expect(second.itemsSkipped).toBe(2);
    expect((await store.getConnectorState("fake"))?.totalItems).toBe(2);

    // the second fetch was asked for items since the advanced cursor
    expect(connector.sinceCalls[0]?.getTime()).toBe(0); // first run started at epoch
  });

  it("serializes concurrent syncs of the same connector so an item ingests once (F-CORE-044/050)", async () => {
    const engine = new SyncEngine({ store });
    // fetchSince yields a tick, so without a per-connector lock both runs are past
    // the cursor read and inside the dedup window before either inserts — exactly
    // the double-ingest race the advisory lock must prevent.
    const makeConn = (): Connector => ({
      name: "fake",
      async fetchSince(): Promise<IngestInput[]> {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return [
          {
            text: "decided once",
            source: "fake:dup",
            timestamp: new Date("2026-03-01T00:00:00.000Z"),
          },
        ];
      },
    });

    const [a, b] = await Promise.all([
      engine.runConnectorInstance("fake", makeConn()),
      engine.runConnectorInstance("fake", makeConn()),
    ]);

    // exactly one run ingested the item; the other saw it already present.
    expect(a.itemsIngested + b.itemsIngested).toBe(1);
    const n = await admin.query<{ n: number }>(
      "select count(*)::int n from evidence where source = $1",
      ["fake:dup"],
    );
    expect(n.rows[0]?.n).toBe(1);
  });

  it("treats an unparseable source timestamp as missing, not an Invalid-Date wedge", async () => {
    const engine = new SyncEngine({ store });
    // a connector item whose source date does not parse: new Date(...) is a
    // truthy Invalid Date. Untreated it pins the watermark (no real date exceeds
    // NaN) and then crashes the unguarded watermark.toISOString(), so the cursor
    // never advances and every later run refetches and crashes identically.
    const conn = new FakeConnector([
      { text: "item with a malformed date", source: "fake:baddate", timestamp: new Date("nope") },
    ]);

    const result = await engine.runConnectorInstance("fake", conn);
    expect(result.status).toBe("ok"); // did NOT throw on toISOString()
    expect(result.itemsIngested).toBe(1);

    const state = await store.getConnectorState("fake");
    // cursor fell back to a valid wall-clock ISO instead of an Invalid Date.
    expect(state?.cursor).toBeDefined();
    expect(Number.isNaN(new Date(state?.cursor ?? "").getTime())).toBe(false);
  });

  it("advances the cursor to the high-water mark of fetched items, not wall-clock time", async () => {
    const engine = new SyncEngine({ store });
    // items carry source-side timestamps; the newest one is the watermark, and
    // it is well in the past so it can never be confused with "now".
    const items = [
      stamped("fake:a", "2026-01-01T00:00:00.000Z"),
      stamped("fake:b", "2026-01-02T00:00:00.000Z"), // newest
    ];

    await engine.runConnectorInstance("fake", new FakeConnector(items));
    const state = await store.getConnectorState("fake");
    expect(state?.cursor).toBe("2026-01-02T00:00:00.000Z");

    // the next run must ask for items strictly since that watermark, so nothing
    // posted just before the previous run can ever be skipped.
    const next = new FakeConnector([]);
    await engine.runConnectorInstance("fake", next);
    expect(next.sinceCalls[0]?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("holds the cursor at the prior watermark on an idle run, never jumping to wall clock", async () => {
    const engine = new SyncEngine({ store });
    await engine.runConnectorInstance(
      "fake",
      new FakeConnector([stamped("fake:a", "2026-01-02T00:00:00.000Z")]),
    );
    expect((await store.getConnectorState("fake"))?.cursor).toBe("2026-01-02T00:00:00.000Z");

    // an idle run (no new items, so no watermark this run) must retain the prior
    // cursor. Before the fix it fell back to ranAt (now), skipping any item that
    // was posted before the watermark but only became visible after this run.
    await engine.runConnectorInstance("fake", new FakeConnector([]));
    expect((await store.getConnectorState("fake"))?.cursor).toBe("2026-01-02T00:00:00.000Z");
  });

  it("advances the watermark past items skipped by dedup, so it never re-fetches forever", async () => {
    const engine = new SyncEngine({ store });
    const items = [stamped("fake:a", "2026-03-01T00:00:00.000Z")];
    await engine.runConnectorInstance("fake", new FakeConnector(items));

    // re-deliver the same (now-deduped) item: it is skipped, but its timestamp
    // must still hold the cursor at the watermark rather than dropping it.
    await engine.runConnectorInstance("fake", new FakeConnector(items));
    expect((await store.getConnectorState("fake"))?.cursor).toBe("2026-03-01T00:00:00.000Z");
  });

  it("on failure records an error run and does NOT advance the cursor", async () => {
    const engine = new SyncEngine({ store });
    // seed a good run so a cursor exists
    await engine.runConnectorInstance("fake", new FakeConnector(drafts));
    const cursorBefore = (await store.getConnectorState("fake"))?.cursor;

    const failed = await engine.runConnectorInstance(
      "fake",
      new FakeConnector([], "403 forbidden"),
    );
    expect(failed.status).toBe("error");
    expect(failed.error).toContain("403 forbidden");

    const state = await store.getConnectorState("fake");
    expect(state?.lastStatus).toBe("error");
    expect(state?.lastError).toContain("403 forbidden");
    expect(state?.cursor).toBe(cursorBefore); // unchanged

    const errorRuns = await store.listRuns({ kind: "connector_sync", status: "error" });
    expect(errorRuns.length).toBe(1);
  });
});

describe("SyncEngine.runConnector", () => {
  const secretKey = "sync-test-secret-key";

  it("resolves a stored connector config by name and decrypts its secret", async () => {
    await store.upsertConnectorConfig({
      name: "github-room",
      kind: "github",
      enabled: true,
      settings: { repos: [] },
      secretCipher: encryptSecret("ghp-test-token", secretKey),
    });

    const result = await new SyncEngine({ store, secretKey }).runConnector("github-room");

    expect(result).toMatchObject({
      name: "github-room",
      itemsIngested: 0,
      itemsSkipped: 0,
      status: "ok",
    });
    expect(result.runId).toMatch(/^run_/);
    expect((await store.listRuns({ kind: "connector_sync" }))[0]?.label).toBe("github-room");
  });

  it("throws when the named connector is not configured", async () => {
    await expect(new SyncEngine({ store }).runConnector("missing")).rejects.toThrow(
      /connector "missing" is not configured/,
    );
  });
});

describe("SyncEngine.runAll", () => {
  class RecordingSyncEngine extends SyncEngine {
    readonly calls: string[] = [];

    override async runConnector(name: string): Promise<ConnectorSyncResult> {
      this.calls.push(name);
      return { name, itemsIngested: 0, itemsSkipped: 0, status: "ok", runId: `run_${name}` };
    }
  }

  it("runs enabled connector configs and skips disabled ones", async () => {
    await store.upsertConnectorConfig({
      name: "disabled-slack",
      kind: "slack",
      enabled: false,
      settings: {},
    });
    await store.upsertConnectorConfig({
      name: "enabled-slack",
      kind: "slack",
      enabled: true,
      settings: {},
    });

    const engine = new RecordingSyncEngine({ store });
    const results = await engine.runAll();

    expect(engine.calls).toEqual(["enabled-slack"]);
    expect(results.map((r) => r.name)).toEqual(["enabled-slack"]);
  });
});

describe("Marrow connector facade", () => {
  it("manages connector config and syncs through the facade methods callers use", async () => {
    const core = new Marrow(store);

    await expect(
      core.upsertConnector({ name: "bad", kind: "myspace", settings: {} }),
    ).rejects.toThrow(/unknown connector kind/);

    const config = await core.upsertConnector({
      name: "github-room",
      kind: "github",
      enabled: false,
      settings: { repos: [] },
    });
    expect(config).toMatchObject({
      name: "github-room",
      kind: "github",
      enabled: false,
      hasSecret: false,
    });

    const listed = await core.listConnectors();
    expect(listed).toEqual([
      expect.objectContaining({ name: "github-room", enabled: false, state: null }),
    ]);

    await core.setConnectorEnabled("github-room", true);
    expect((await core.listConnectors())[0]).toMatchObject({
      name: "github-room",
      enabled: true,
    });

    const single = await core.syncConnector("github-room");
    expect(single).toMatchObject({
      name: "github-room",
      status: "ok",
      itemsIngested: 0,
      itemsSkipped: 0,
    });
    expect(single.runId).toMatch(/^run_/);

    const all = await core.syncAllConnectors();
    expect(all).toEqual([expect.objectContaining({ name: "github-room", status: "ok" })]);

    await core.deleteConnector("github-room");
    expect(await core.listConnectors()).toEqual([]);
  });
});

describe("Store.withConnectorLock", () => {
  it("serializes two syncs of the same connector: the second waits for the first", async () => {
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));

    const a = store.withConnectorLock("fake", async () => {
      order.push("a-acquired");
      await held; // hold the lock until the test releases it
      order.push("a-releasing");
    });
    await new Promise((r) => setTimeout(r, 50)); // let A acquire first

    const b = store.withConnectorLock("fake", async () => {
      order.push("b-acquired");
    });
    await new Promise((r) => setTimeout(r, 50));

    // while A holds the connector lock, B is blocked and has not run.
    expect(order).toEqual(["a-acquired"]);

    release();
    await Promise.all([a, b]);
    expect(order).toEqual(["a-acquired", "a-releasing", "b-acquired"]);
  });

  it("does not block syncs of different connectors", async () => {
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));

    const a = store.withConnectorLock("conn-a", async () => {
      order.push("a");
      await held;
    });
    await new Promise((r) => setTimeout(r, 50));

    // a different connector's lock is independent, so this runs immediately.
    await store.withConnectorLock("conn-b", async () => {
      order.push("b");
    });
    expect(order).toEqual(["a", "b"]);

    release();
    await a;
  });

  it("releases the lock even when the body throws", async () => {
    await expect(
      store.withConnectorLock("fake", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // a subsequent acquire must not hang, proving the lock was released.
    const ran = await store.withConnectorLock("fake", async () => "ok");
    expect(ran).toBe("ok");
  });
});

describe("Store.withDistillLock", () => {
  it("serializes two distills of the same evidence: the second waits for the first", async () => {
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));

    const a = store.withDistillLock("ev_1", async () => {
      order.push("a-acquired");
      await held;
      order.push("a-releasing");
    });
    await new Promise((r) => setTimeout(r, 50)); // let A acquire first

    const b = store.withDistillLock("ev_1", async () => {
      order.push("b-acquired");
    });
    await new Promise((r) => setTimeout(r, 50));

    // while A holds the evidence lock, B is blocked and has not run.
    expect(order).toEqual(["a-acquired"]);

    release();
    await Promise.all([a, b]);
    expect(order).toEqual(["a-acquired", "a-releasing", "b-acquired"]);
  });

  it("does not block distills of different evidence rows", async () => {
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));

    const a = store.withDistillLock("ev_a", async () => {
      order.push("a");
      await held;
    });
    await new Promise((r) => setTimeout(r, 50));

    // a different evidence id's lock is independent, so this runs immediately.
    await store.withDistillLock("ev_b", async () => {
      order.push("b");
    });
    expect(order).toEqual(["a", "b"]);

    release();
    await a;
  });

  it("releases the evidence lock even when the body throws", async () => {
    await expect(
      store.withDistillLock("ev_boom", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const ran = await store.withDistillLock("ev_boom", async () => "ok");
    expect(ran).toBe("ok");
  });
});

describe("buildConnector", () => {
  it("keeps the exported connector kind registry in lockstep with the factory", () => {
    expect(CONNECTOR_KINDS).toEqual([
      "slack",
      "github",
      "linear",
      "notion",
      "figma",
      "zoom",
      "intercom",
      "email",
      "teams",
      "jira",
      "granola",
      "otter",
    ]);
    for (const kind of CONNECTOR_KINDS) {
      expect(buildConnector(kind, {}, "secret").name).toEqual(expect.any(String));
    }
  });

  it("builds known connector kinds from settings + secret", () => {
    const slack = buildConnector("slack", { channelIds: ["C1"] }, "xoxb-token");
    expect(slack.name).toBe("slack");
    const jira = buildConnector(
      "jira",
      { baseUrl: "x.atlassian.net", email: "a@b.com", projectKeys: ["ENG"] },
      "api-token",
    );
    expect(jira.name).toBe("jira");
    const email = buildConnector("email", {}, "ya29-token");
    expect(email.name).toBe("email");
  });

  it("throws on an unknown kind", () => {
    expect(() => buildConnector("myspace", {}, "x")).toThrow(/unknown connector kind/);
  });
});
