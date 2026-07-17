import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

async function loadExportDemo() {
  return import("../scripts/export-demo");
}

describe("export-demo static snapshot", () => {
  const oldDatabaseUrl = process.env.DATABASE_URL;
  const temps: string[] = [];

  afterEach(() => {
    process.env.DATABASE_URL = oldDatabaseUrl;
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("can be imported without DATABASE_URL and writes the read-only snapshot files", async () => {
    delete process.env.DATABASE_URL;
    const mod = await loadExportDemo();
    const root = mkdtempSync(join(tmpdir(), "marrow-export-"));
    temps.push(root);
    const clientDir = join(root, "client");
    const outDir = join(root, "demo-static");
    mkdirSync(clientDir, { recursive: true });
    writeFileSync(join(clientDir, "index.html"), "<main>demo</main>");
    writeFileSync(join(clientDir, "asset.txt"), "asset");

    const core = {
      getDecisions: async () => [{ id: "dec_1", title: "Magic links only" }],
      listEntities: async () => [{ id: "ent_1", name: "Auth" }],
      getOpenQuestions: async () => [{ id: "q_1", prompt: "Confirm auth" }],
      getGraph: async () => ({ nodes: [{ id: "dec_1" }], edges: [] }),
      traceToSource: async (id: string) => ({
        id,
        spans: [{ evidenceId: "ev_1", start: 0, end: 4 }],
      }),
    };

    // the read surface beyond state + trace: the real export wires these from the
    // store; here they are stubbed so the snapshot files and rewrites are covered.
    const endpoints = {
      metrics: async () => ({ total: 2, errorRate: 0 }),
      runs: async () => [
        { id: "run_1", kind: "ingest" },
        { id: "run_2", kind: "distill" },
      ],
      connectors: async () => [] as unknown[],
      goals: async () => [{ id: "goal_1", title: "One price per workspace" }],
      catches: async () => [{ id: "q_1", decisionTitle: "Free trial, no card upfront" }],
      catchMetrics: async () => ({ surfaced: 1, actedOn: 0, dismissed: 0 }),
      recentEvidence: async () => [{ id: "ev_1", source: "standups/x.md" }],
    };

    const summary = await mod.exportStaticDemo({ core, clientDir, outDir, endpoints });

    expect(summary).toEqual({
      decisions: 1,
      entities: 1,
      questions: 1,
      traces: 3,
      runs: 2,
      catches: 1,
      goals: 1,
      outDir,
    });
    expect(readFileSync(join(outDir, "index.html"), "utf8")).toContain("demo");
    expect(readFileSync(join(outDir, "asset.txt"), "utf8")).toBe("asset");
    const state = JSON.parse(readFileSync(join(outDir, "api", "state.json"), "utf8")) as {
      readOnly: boolean;
      decisions: unknown[];
      entities: unknown[];
      questions: unknown[];
      graph: { nodes: unknown[]; edges: unknown[] };
    };
    expect(state.readOnly).toBe(true);
    // the living map's data must ride in the snapshot: an absent graph made
    // the hosted demo's Graph view claim the brain was empty.
    expect(state.graph.nodes.length).toBeGreaterThan(0);
    expect(state.decisions).toHaveLength(1);
    expect(state.entities).toHaveLength(1);
    expect(state.questions).toHaveLength(1);
    expect(existsSync(join(outDir, "api", "trace", "dec_1.json"))).toBe(true);
    expect(existsSync(join(outDir, "api", "trace", "ent_1.json"))).toBe(true);
    expect(existsSync(join(outDir, "api", "trace", "q_1.json"))).toBe(true);

    // every read endpoint is snapshotted, so no demo tab 404s.
    const runs = JSON.parse(readFileSync(join(outDir, "api", "runs.json"), "utf8")) as unknown[];
    expect(runs).toHaveLength(2);
    expect(existsSync(join(outDir, "api", "metrics.json"))).toBe(true);
    expect(existsSync(join(outDir, "api", "connectors.json"))).toBe(true);
    expect(existsSync(join(outDir, "api", "goals.json"))).toBe(true);
    expect(existsSync(join(outDir, "api", "catches.json"))).toBe(true);
    expect(existsSync(join(outDir, "api", "catches", "metrics.json"))).toBe(true);
    expect(existsSync(join(outDir, "api", "evidence", "recent.json"))).toBe(true);

    const config = JSON.parse(readFileSync(join(outDir, "vercel.json"), "utf8")) as {
      rewrites: { source: string; destination: string }[];
    };
    expect(config.rewrites).toEqual([
      { source: "/api/state", destination: "/api/state.json" },
      { source: "/api/trace/:id", destination: "/api/trace/:id.json" },
      { source: "/api/metrics", destination: "/api/metrics.json" },
      { source: "/api/runs", destination: "/api/runs.json" },
      { source: "/api/connectors", destination: "/api/connectors.json" },
      { source: "/api/goals", destination: "/api/goals.json" },
      { source: "/api/catches/metrics", destination: "/api/catches/metrics.json" },
      { source: "/api/catches", destination: "/api/catches.json" },
      { source: "/api/evidence/recent", destination: "/api/evidence/recent.json" },
      { source: "/((?!api/).*)", destination: "/index.html" },
    ]);
  });

  it("fails loud when the built SPA is missing", async () => {
    const mod = await loadExportDemo();
    const root = mkdtempSync(join(tmpdir(), "marrow-export-"));
    temps.push(root);
    await expect(
      mod.exportStaticDemo({
        core: {
          getDecisions: async () => [],
          listEntities: async () => [],
          getOpenQuestions: async () => [],
          getGraph: async () => ({ nodes: [], edges: [] }),
          traceToSource: async () => ({}),
        },
        clientDir: join(root, "missing-client"),
        outDir: join(root, "demo-static"),
      }),
    ).rejects.toThrow(/no built SPA/);
  });
});
