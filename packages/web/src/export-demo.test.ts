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
      traceToSource: async (id: string) => ({
        id,
        spans: [{ evidenceId: "ev_1", start: 0, end: 4 }],
      }),
    };

    const summary = await mod.exportStaticDemo({ core, clientDir, outDir });

    expect(summary).toEqual({
      decisions: 1,
      entities: 1,
      questions: 1,
      traces: 3,
      outDir,
    });
    expect(readFileSync(join(outDir, "index.html"), "utf8")).toContain("demo");
    expect(readFileSync(join(outDir, "asset.txt"), "utf8")).toBe("asset");
    const state = JSON.parse(readFileSync(join(outDir, "api", "state.json"), "utf8")) as {
      readOnly: boolean;
      decisions: unknown[];
      entities: unknown[];
      questions: unknown[];
    };
    expect(state.readOnly).toBe(true);
    expect(state.decisions).toHaveLength(1);
    expect(state.entities).toHaveLength(1);
    expect(state.questions).toHaveLength(1);
    expect(existsSync(join(outDir, "api", "trace", "dec_1.json"))).toBe(true);
    expect(existsSync(join(outDir, "api", "trace", "ent_1.json"))).toBe(true);
    expect(existsSync(join(outDir, "api", "trace", "q_1.json"))).toBe(true);
    const config = JSON.parse(readFileSync(join(outDir, "vercel.json"), "utf8")) as {
      rewrites: { source: string; destination: string }[];
    };
    expect(config.rewrites).toEqual([
      { source: "/api/state", destination: "/api/state.json" },
      { source: "/api/trace/:id", destination: "/api/trace/:id.json" },
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
          traceToSource: async () => ({}),
        },
        clientDir: join(root, "missing-client"),
        outDir: join(root, "demo-static"),
      }),
    ).rejects.toThrow(/no built SPA/);
  });
});
