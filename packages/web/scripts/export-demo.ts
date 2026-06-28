// Export the seeded brain as a static, zero-backend demo. The read-only demo
// only ever GETs /api/state and /api/trace/:id, and answers run client-side in
// the sandbox, so a JSON snapshot of the seeded brain serves the whole surface
// with no server, no database and nothing to fall over.
//
//   1. seed a local brain:   DATABASE_URL=... npx tsx packages/web/scripts/seed-demo.ts
//   2. build the SPA:        pnpm --filter web build
//   3. export the snapshot:  DATABASE_URL=... npx tsx packages/web/scripts/export-demo.ts
//
// The result in packages/web/demo-static/ deploys as-is (vercel.json included).
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Marrow, Store } from "@marrowhq/core";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const clientDir = join(webRoot, "dist", "client");
const outDir = join(webRoot, "demo-static");

export interface StaticDemoNode {
  id: string;
}

export interface StaticDemoCore {
  getDecisions(): Promise<StaticDemoNode[]>;
  listEntities(): Promise<StaticDemoNode[]>;
  getOpenQuestions(): Promise<StaticDemoNode[]>;
  traceToSource(nodeId: string): Promise<unknown>;
}

export interface StaticDemoExportOptions {
  core: StaticDemoCore;
  clientDir: string;
  outDir: string;
}

export interface StaticDemoExportSummary {
  decisions: number;
  entities: number;
  questions: number;
  traces: number;
  outDir: string;
}

export function staticDemoVercelConfig(): Record<string, unknown> {
  return {
    $schema: "https://openapi.vercel.sh/vercel.json",
    rewrites: [
      { source: "/api/state", destination: "/api/state.json" },
      { source: "/api/trace/:id", destination: "/api/trace/:id.json" },
      { source: "/((?!api/).*)", destination: "/index.html" },
    ],
    headers: [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ],
  };
}

export async function exportStaticDemo({
  core,
  clientDir,
  outDir,
}: StaticDemoExportOptions): Promise<StaticDemoExportSummary> {
  if (!existsSync(join(clientDir, "index.html"))) {
    throw new Error(
      "export-demo: no built SPA at dist/client. Run `pnpm --filter web build` first.",
    );
  }

  const [decisions, entities, questions] = await Promise.all([
    core.getDecisions(),
    core.listEntities(),
    core.getOpenQuestions(),
  ]);
  // The hosted snapshot is read only by construction: there is no server to
  // accept a write. The flag tells the UI to answer in the sandbox.
  const state = { decisions, entities, questions, readOnly: true };

  rmSync(outDir, { recursive: true, force: true });
  cpSync(clientDir, outDir, { recursive: true });
  mkdirSync(join(outDir, "api", "trace"), { recursive: true });
  writeFileSync(join(outDir, "api", "state.json"), JSON.stringify(state));

  const nodes = [...decisions, ...entities, ...questions];
  for (const node of nodes) {
    const trace = await core.traceToSource(node.id);
    writeFileSync(join(outDir, "api", "trace", `${node.id}.json`), JSON.stringify(trace));
  }

  // routes: /api/state and /api/trace/:id map onto the snapshot files, every
  // other path falls back to the SPA. headers mirror packages/web/vercel.json.
  writeFileSync(join(outDir, "vercel.json"), JSON.stringify(staticDemoVercelConfig(), null, 2));

  return {
    decisions: decisions.length,
    entities: entities.length,
    questions: questions.length,
    traces: nodes.length,
    outDir,
  };
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("export-demo: set DATABASE_URL to the seeded brain.");
    process.exit(1);
  }

  const store = new Store(url);
  try {
    const core = new Marrow(store);
    const summary = await exportStaticDemo({ core, clientDir, outDir });
    console.log(
      `exported ${summary.decisions} decisions, ${summary.entities} entities, ${summary.questions} questions and ${summary.traces} traces to ${summary.outDir}`,
    );
  } finally {
    await store.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error: unknown) => {
    console.error("export-demo failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
