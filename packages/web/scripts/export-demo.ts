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
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Marrow, Store } from "@marrowhq/core";

import {
  getCatches,
  getCatchMetricsView,
  getConnectors,
  getGoals,
  recentEvidence,
} from "../src/api.js";

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

/** The read endpoints the SPA GETs beyond state + trace. Each returns the full
 *  seeded list; the export writes one JSON snapshot per endpoint and the vercel
 *  rewrites point the live paths at them. Optional so the unit test can snapshot
 *  just state + trace with a mock core, while the real export wires all of them
 *  from the store (see main). */
export interface StaticDemoEndpoints {
  metrics: () => Promise<unknown>;
  runs: () => Promise<unknown[]>;
  connectors: () => Promise<unknown[]>;
  goals: () => Promise<unknown[]>;
  catches: () => Promise<unknown[]>;
  catchMetrics: () => Promise<unknown>;
  recentEvidence: () => Promise<unknown[]>;
}

export interface StaticDemoExportOptions {
  core: StaticDemoCore;
  clientDir: string;
  outDir: string;
  endpoints?: StaticDemoEndpoints;
}

export interface StaticDemoExportSummary {
  decisions: number;
  entities: number;
  questions: number;
  traces: number;
  runs: number;
  catches: number;
  goals: number;
  outDir: string;
}

export function staticDemoVercelConfig(): Record<string, unknown> {
  return {
    $schema: "https://openapi.vercel.sh/vercel.json",
    // the export is already built: deploy this directory as plain static
    // files, never look for a framework build output.
    buildCommand: "",
    outputDirectory: ".",
    // every read endpoint the SPA GETs maps onto a snapshot file. static files
    // ignore query strings, so the one snapshot per path holds the full list and
    // the read-only views slice/filter it client-side (see Observability). the
    // more specific /api/catches/metrics must precede /api/catches.
    rewrites: [
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
  endpoints,
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

  // wipe the snapshot but keep .vercel/: it holds the project link the deploy
  // command needs, and losing it silently deploys to a fresh project.
  const vercelLink = join(outDir, ".vercel");
  const keptLink = join(webRoot, ".vercel-link-keep");
  if (existsSync(vercelLink)) cpSync(vercelLink, keptLink, { recursive: true });
  rmSync(outDir, { recursive: true, force: true });
  cpSync(clientDir, outDir, { recursive: true });
  if (existsSync(keptLink)) {
    cpSync(keptLink, vercelLink, { recursive: true });
    rmSync(keptLink, { recursive: true, force: true });
  }
  mkdirSync(join(outDir, "api", "trace"), { recursive: true });
  writeFileSync(join(outDir, "api", "state.json"), JSON.stringify(state));

  // mark the snapshot as the hosted demo before the pre-paint theme script
  // runs: the demo defaults dark to match the landing it is reached from.
  const indexPath = join(outDir, "index.html");
  const indexHtml = readFileSync(indexPath, "utf8").replace(
    "<script>",
    "<script>window.__MARROW_DEMO__=true;</script>\n    <script>",
  );
  writeFileSync(indexPath, indexHtml);

  const nodes = [...decisions, ...entities, ...questions];
  for (const node of nodes) {
    const trace = await core.traceToSource(node.id);
    writeFileSync(join(outDir, "api", "trace", `${node.id}.json`), JSON.stringify(trace));
  }

  // the rest of the read surface: observability, connectors, goals, catches and
  // recent evidence, snapshotted from the seeded brain so every nav tab loads
  // real data instead of a 404. one file per endpoint path (query strings are
  // ignored by static hosting; the read-only views filter client-side).
  let runs = 0;
  let catches = 0;
  let goals = 0;
  if (endpoints) {
    mkdirSync(join(outDir, "api", "catches"), { recursive: true });
    mkdirSync(join(outDir, "api", "evidence"), { recursive: true });
    const [metrics, runList, connectors, goalList, catchList, catchMetrics, evidence] =
      await Promise.all([
        endpoints.metrics(),
        endpoints.runs(),
        endpoints.connectors(),
        endpoints.goals(),
        endpoints.catches(),
        endpoints.catchMetrics(),
        endpoints.recentEvidence(),
      ]);
    writeFileSync(join(outDir, "api", "metrics.json"), JSON.stringify(metrics));
    writeFileSync(join(outDir, "api", "runs.json"), JSON.stringify(runList));
    writeFileSync(join(outDir, "api", "connectors.json"), JSON.stringify(connectors));
    writeFileSync(join(outDir, "api", "goals.json"), JSON.stringify(goalList));
    writeFileSync(join(outDir, "api", "catches.json"), JSON.stringify(catchList));
    writeFileSync(join(outDir, "api", "catches", "metrics.json"), JSON.stringify(catchMetrics));
    writeFileSync(join(outDir, "api", "evidence", "recent.json"), JSON.stringify(evidence));
    runs = runList.length;
    catches = catchList.length;
    goals = goalList.length;
  }

  // routes: every read endpoint maps onto its snapshot file, every other path
  // falls back to the SPA. headers mirror packages/web/vercel.json.
  writeFileSync(join(outDir, "vercel.json"), JSON.stringify(staticDemoVercelConfig(), null, 2));

  return {
    decisions: decisions.length,
    entities: entities.length,
    questions: questions.length,
    traces: nodes.length,
    runs,
    catches,
    goals,
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
    const endpoints = {
      metrics: () => store.runMetrics({}),
      runs: () => store.listRuns({ limit: 200 }),
      connectors: () => getConnectors(store),
      goals: () => getGoals(store),
      catches: () => getCatches(store),
      catchMetrics: () => getCatchMetricsView(store),
      recentEvidence: () => recentEvidence(store, 30),
    };
    const summary = await exportStaticDemo({ core, clientDir, outDir, endpoints });
    console.log(
      `exported ${summary.decisions} decisions, ${summary.entities} entities, ` +
        `${summary.questions} questions, ${summary.traces} traces, ${summary.runs} runs, ` +
        `${summary.goals} goals and ${summary.catches} catches to ${summary.outDir}`,
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
