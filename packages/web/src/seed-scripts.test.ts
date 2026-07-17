import { afterEach, describe, expect, it, vi } from "vitest";

async function importSeedModules() {
  const [room, demo, consoleSeed] = await Promise.all([
    import("../scripts/seed-room"),
    import("../scripts/seed-demo"),
    import("../scripts/seed-console"),
  ]);
  return { room, demo, consoleSeed };
}

type ProposedNode = {
  id: string;
  kind: string;
  title?: string;
  name?: string;
  prompt?: string;
  relatesTo?: string[];
  provenance: { evidenceId: string; start: number; end: number }[];
};

describe("web seed scripts", () => {
  const oldDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    process.env.DATABASE_URL = oldDatabaseUrl;
    vi.restoreAllMocks();
  });

  it("are import-safe without DATABASE_URL", async () => {
    delete process.env.DATABASE_URL;
    await expect(importSeedModules()).resolves.toBeTruthy();
  });

  it("widenTheRoom appends room evidence, proposes cited nodes, promotes settled facts and leaves one conflict open", async () => {
    const { room } = await importSeedModules();
    const ingested: { id: string; text: string; source: string }[] = [];
    const proposed: ProposedNode[] = [];
    const answers: { id: string; text: string }[] = [];
    let next = 0;
    const core = {
      ingest: async ({ text, source }: { text: string; source: string }) => {
        const id = `ev_${source.split("/")[0]}_${ingested.length}`;
        ingested.push({ id, text, source });
        return id;
      },
      proposeNode: async (node: Omit<ProposedNode, "id">) => {
        const id = `${node.kind}_${next++}`;
        const created = { ...node, id };
        proposed.push(created);
        return created;
      },
      answer: async (id: string, text: string) => {
        answers.push({ id, text });
        return { promoted: [], superseded: [] };
      },
    };

    await room.widenTheRoom(core as unknown as Parameters<typeof room.widenTheRoom>[0]);

    expect(ingested.map((e) => e.source)).toEqual([
      "standups/2026-06-02.md",
      "interviews/design-review.md",
      "notes/pricing-call-2026-05-28.md",
    ]);
    expect(answers).toHaveLength(2);
    expect(proposed.some((n) => n.title === "The trial is cut to 7 days")).toBe(true);
    expect(
      proposed.find((n) => n.title === "The trial is cut to 7 days")!.provenance[0],
    ).toMatchObject({ evidenceId: ingested[0]!.id });
    const conflict = proposed.find((n) => n.prompt?.includes("trial length"));
    expect(conflict?.relatesTo).toHaveLength(2);
    expect(answers.map((a) => a.id)).not.toContain(conflict?.id);
    for (const node of proposed) {
      for (const span of node.provenance) {
        const evidence = ingested.find((e) => e.id === span.evidenceId);
        expect(evidence?.text.slice(span.start, span.end)).not.toBe("");
      }
    }
  });

  it("spanOf fails loud when a seeded quote drifts", async () => {
    const { room } = await importSeedModules();
    expect(() => room.spanOf("ev_missing", room.STANDUP, "quote that is not in the room")).toThrow(
      /quote not found/,
    );
  });
});
