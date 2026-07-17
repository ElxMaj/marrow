// Seed the isolated console brain. Run against the local marrow_console DB only:
//
//   DATABASE_URL=postgres://marrow:marrow@localhost:5432/marrow_console \
//   MARROW_SECRET_KEY=dev-console-key \
//   npx tsx packages/web/scripts/seed-console.ts
//
// It applies the core migrations (idempotent), seeds the same rich product room
// the demo uses (runDemo + widenTheRoom), then populates the console surfaces:
// six connectors with encrypted secrets and believable sync state (five ok, one
// erroring), and a few days of observability runs across every kind so the
// dashboard, connector strip and runs table are all rich. Run once on a fresh
// marrow_console; re-running appends (evidence is immutable), so reset first if
// you want clean numbers.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEMO_INTERVIEW,
  LocalEmbeddingProvider,
  Marrow,
  Store,
  createDemoModel,
  encryptSecret,
  runDemo,
  type DiffHunk,
} from "@marrowhq/core";
import pg from "pg";

import { widenTheRoom } from "./seed-room.js";

const SECRET_KEY = process.env.MARROW_SECRET_KEY ?? "dev-console-key";
const here = dirname(fileURLToPath(import.meta.url));
const migrate = join(here, "..", "..", "core", "scripts", "migrate.mjs");

// opus rates: $15 / Mtok in, $75 / Mtok out. the numbers the dashboard sums.
const COST_IN = 15 / 1_000_000;
const COST_OUT = 75 / 1_000_000;
const cost = (tin: number, tout: number): number =>
  Number((tin * COST_IN + tout * COST_OUT).toFixed(4));

// a tiny deterministic RNG so the seeded history is reproducible run to run.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(0x5eed_c0de);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)] as T;
const between = (lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));
const minutesAgo = (m: number): string => new Date(Date.now() - m * 60_000).toISOString();
const syntheticHunk = ({
  path,
  lineStart,
  lineEnd,
  newLines,
}: {
  path: string;
  lineStart: number;
  lineEnd: number;
  newLines: string;
}): DiffHunk => ({
  path,
  lineStart,
  lineEnd,
  oldLines: "",
  newLines,
  hunkHeader: `@@ -${lineStart},0 +${lineStart},${Math.max(1, lineEnd - lineStart + 1)} @@`,
});

interface RunSeed {
  kind: "distill" | "search" | "drift" | "connector_sync" | "ingest";
  status: "ok" | "error";
  label?: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  latencyMs: number;
  inputSummary?: string;
  outputSummary?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  createdAt: string; // explicit, so the trace spreads over real time
}

const RUN_COLS =
  "id, kind, status, label, model, tokens_in, tokens_out, cost_usd, latency_ms, input_summary, output_summary, error, parent_id, metadata, created_at";

async function insertRun(pool: pg.Pool, r: RunSeed): Promise<void> {
  await pool.query(
    `insert into run (${RUN_COLS})
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)`,
    [
      `run_${randomUUID()}`,
      r.kind,
      r.status,
      r.label ?? null,
      r.model ?? null,
      r.tokensIn ?? null,
      r.tokensOut ?? null,
      r.costUsd ?? null,
      r.latencyMs,
      r.inputSummary ?? null,
      r.outputSummary ?? null,
      r.error ?? null,
      null,
      r.metadata ? JSON.stringify(r.metadata) : null,
      r.createdAt,
    ],
  );
}

// the six connectors: five flowing, one erroring on a rejected token so the
// error UI shows. each carries believable settings and an encrypted fake token.
const CONNECTORS: {
  name: string;
  kind: string;
  settings: Record<string, unknown>;
  items: number;
  agoMin: number;
  status: "ok" | "error";
  error?: string;
}[] = [
  {
    name: "slack",
    kind: "slack",
    settings: { channelIds: ["C_PRODUCT", "C_ENG", "C_DESIGN"] },
    items: 142,
    agoMin: 9,
    status: "ok",
  },
  {
    name: "email",
    kind: "email",
    settings: { query: "to:brain@inbound.marrowhq.com newer_than:7d" },
    items: 31,
    agoMin: 14,
    status: "ok",
  },
  {
    name: "granola",
    kind: "granola",
    settings: { workspaceId: "ws_acme" },
    items: 17,
    agoMin: 41,
    status: "ok",
  },
  {
    name: "linear",
    kind: "linear",
    settings: { teamIds: ["TEAM_PRODUCT", "TEAM_GROWTH"] },
    items: 24,
    agoMin: 73,
    status: "ok",
  },
  {
    name: "github",
    kind: "github",
    settings: {
      repos: [
        { owner: "acme", repo: "app" },
        { owner: "acme", repo: "api" },
      ],
    },
    items: 38,
    agoMin: 126,
    status: "ok",
  },
  {
    name: "jira",
    kind: "jira",
    settings: {
      baseUrl: "https://acme.atlassian.net",
      email: "ops@acme.com",
      projectKeys: ["PROD", "BUG"],
    },
    items: 0,
    agoMin: 312,
    status: "error",
    error: "401 unauthorized: the jira api token was rejected, re-authenticate the connection",
  },
];

const DISTILL_SOURCES = [
  "standups/2026-06-02.md",
  "interviews/design-review.md",
  "notes/pricing-call-2026-05-28.md",
  "slack/C_PRODUCT/threads",
  "email/billing-escalation",
  "granola/weekly-product-sync",
  "linear/PROD-1184",
  "github/acme/app#412",
];
const SEARCH_QUERIES = [
  "trial length policy",
  "card wall drift",
  "offline editor sync",
  "overage billing cap or charge",
  "free trial scope",
  "presence dots in the editor",
  "per workspace pricing",
  "payment dunning backoff",
];

async function seedConnectors(store: Store, pool: pg.Pool): Promise<void> {
  for (const c of CONNECTORS) {
    await store.upsertConnectorConfig({
      name: c.name,
      kind: c.kind,
      enabled: true,
      settings: c.settings,
      secretCipher: encryptSecret("fake-token", SECRET_KEY),
    });
    const ranAt = minutesAgo(c.agoMin);
    await store.recordSyncOutcome(c.name, {
      ok: c.status === "ok",
      ...(c.status === "ok" ? { cursor: ranAt } : {}),
      itemsIngested: c.items,
      ...(c.error ? { error: c.error } : {}),
      ranAt,
    });
    // a matching connector_sync run so the most recent sync also shows in the
    // runs table and the overview activity feed.
    await insertRun(pool, {
      kind: "connector_sync",
      status: c.status,
      label: c.name,
      latencyMs: between(220, 1600),
      ...(c.status === "ok"
        ? { outputSummary: `${c.items} ingested, ${between(0, 9)} skipped` }
        : c.error
          ? { error: c.error }
          : {}),
      metadata: { itemsIngested: c.items, itemsSkipped: c.status === "ok" ? between(0, 9) : 0 },
      createdAt: ranAt,
    });
  }
}

async function seedCatches(core: Marrow): Promise<void> {
  // synthetic hunks that contradict the decided facts from widenTheRoom:
  // - trial decision: "free trial, no card upfront"
  // - pricing decision: "pricing is per workspace, flat, no per-seat metering"
  // - offline decision: "the editor works offline and syncs when the connection returns"
  const HUNKS: DiffHunk[] = [
    syntheticHunk({
      path: "src/signup/card-wall.ts",
      lineStart: 12,
      lineEnd: 18,
      newLines: `// block the trial until a card is on file
export async function requireCardAtSignup(customerId: string): Promise<SetupIntent> {
  return stripe.setupIntents.create({ customer: customerId, usage: "off_session" });
}

export function trialStartsAfterCard(): boolean {
  return true;
}`,
    }),
    syntheticHunk({
      path: "src/billing/seats.ts",
      lineStart: 8,
      lineEnd: 14,
      newLines: `export function calculateMonthlyCost(seatCount: number): number {
  const basePrice = 29;
  const perSeatPrice = 12;
  return basePrice + (seatCount * perSeatPrice);
}

export function prorateSeatCount(seats: number, daysInMonth: number): number {
  return Math.ceil(seats * (daysInMonth / 30));
}`,
    }),
    syntheticHunk({
      path: "src/editor/sync.ts",
      lineStart: 24,
      lineEnd: 30,
      newLines: `export function saveDocument(docId: string, content: string): void {
  if (!navigator.onLine) {
    throw new Error("cannot save while offline");
  }
  fetch("/api/documents", {
    method: "POST",
    body: JSON.stringify({ id: docId, content }),
  });
}`,
    }),
    syntheticHunk({
      path: "src/auth/session.ts",
      lineStart: 42,
      lineEnd: 48,
      newLines: `const SESSION_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 hours

export function checkSessionExpiry(lastActive: number): boolean {
  return Date.now() - lastActive > SESSION_TIMEOUT_MS;
}`,
    }),
    syntheticHunk({
      path: "src/billing/usage.ts",
      lineStart: 15,
      lineEnd: 21,
      newLines: `export interface UsageMetrics {
  workspaceId: string;
  seats: number;
  storageBytes: number;
  apiCalls: number;
}`,
    }),
  ];

  console.log("seeding drift catches…");
  const result = await core.driftScan("demo-repo", {
    hunks: HUNKS,
    semantic: false,
    synthetic: false,
  });

  console.log(`  created ${result.created.length} drift catches`);

  // accept 1-2 catches, dismiss 1, leave the rest open
  if (result.created.length >= 3) {
    const toAccept = result.created[0];
    const toDismiss = result.created[1];
    if (!toAccept || !toDismiss) return;

    await core.acceptCatch(
      toAccept.id,
      "fixed: removed the card wall, the trial starts without a card again",
    );
    console.log(`  accepted catch ${toAccept.id}`);

    await core.dismissCatch(toDismiss.id, "false positive: this is legacy code, not in active use");
    console.log(`  dismissed catch ${toDismiss.id}`);
  }
}

async function seedObservability(pool: pg.Pool): Promise<void> {
  const runs: RunSeed[] = [];

  // ~18 distill runs across the last six days, opus with realistic usage.
  for (let i = 0; i < 18; i++) {
    const tokensIn = between(1500, 4200);
    const tokensOut = between(380, 1300);
    const ents = between(0, 4);
    const decs = between(0, 2);
    const qs = between(0, 3);
    runs.push({
      kind: "distill",
      status: "ok",
      label: pick(DISTILL_SOURCES),
      model: "claude-opus-4-8",
      tokensIn,
      tokensOut,
      costUsd: cost(tokensIn, tokensOut),
      latencyMs: between(1800, 6500),
      inputSummary: `${between(280, 2400)} tokens of transcript`,
      outputSummary: `${ents} entities, ${decs} decisions, ${qs} questions`,
      createdAt: minutesAgo(between(20, 6 * 24 * 60)),
    });
  }

  // ~22 retrieval runs, no model, sub-100ms: the task-scoped context the agent pulls.
  for (let i = 0; i < 22; i++) {
    runs.push({
      kind: "search",
      status: "ok",
      label: pick(SEARCH_QUERIES),
      latencyMs: between(18, 85),
      outputSummary: `${between(3, 8)} results`,
      createdAt: minutesAgo(between(8, 6 * 24 * 60)),
    });
  }

  // a few drift scans: opus comparing a decided node against the repo.
  for (let i = 0; i < 3; i++) {
    const tokensIn = between(900, 2600);
    const tokensOut = between(200, 700);
    runs.push({
      kind: "drift",
      status: "ok",
      label: "acme/app",
      model: "claude-opus-4-8",
      tokensIn,
      tokensOut,
      costUsd: cost(tokensIn, tokensOut),
      latencyMs: between(2200, 9000),
      outputSummary: `${between(0, 2)} drift hits`,
      createdAt: minutesAgo(between(120, 6 * 24 * 60)),
    });
  }

  // two extra connector_sync runs from earlier in the week (cursors before now).
  for (const name of ["slack", "github"]) {
    runs.push({
      kind: "connector_sync",
      status: "ok",
      label: name,
      latencyMs: between(240, 1400),
      outputSummary: `${between(4, 40)} ingested, ${between(0, 12)} skipped`,
      metadata: { itemsIngested: between(4, 40), itemsSkipped: between(0, 12) },
      createdAt: minutesAgo(between(8 * 60, 5 * 24 * 60)),
    });
  }

  // three error runs so the error rate and the error UI are real.
  runs.push({
    kind: "distill",
    status: "error",
    label: "slack/C_ENG/threads",
    model: "claude-opus-4-8",
    latencyMs: 60_142,
    error: "model request timed out after 60s; the transcript will be retried on the next pass",
    createdAt: minutesAgo(between(180, 3 * 24 * 60)),
  });
  runs.push({
    kind: "search",
    status: "error",
    label: "annual plan churn",
    latencyMs: 12,
    error: "embedding provider unavailable; fell back to keyword search",
    createdAt: minutesAgo(between(60, 2 * 24 * 60)),
  });
  runs.push({
    kind: "connector_sync",
    status: "error",
    label: "jira",
    latencyMs: 845,
    error: "401 unauthorized: the jira api token was rejected, re-authenticate the connection",
    metadata: { itemsIngested: 0, itemsSkipped: 0 },
    createdAt: minutesAgo(between(300, 4 * 24 * 60)),
  });

  for (const r of runs) await insertRun(pool, r);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "seed-console: set DATABASE_URL to the local console DB (marrow_console), never production.",
    );
    process.exit(1);
  }
  if (!/marrow_console/.test(url)) {
    console.error(
      `seed-console: refusing to run against "${url}". This seed is for marrow_console only.`,
    );
    process.exit(1);
  }

  console.log("applying migrations (idempotent)…");
  execFileSync("node", [migrate], { env: process.env, stdio: "inherit" });

  const store = new Store(url);
  const pool = new pg.Pool({ connectionString: url });
  const core = new Marrow(store, createDemoModel(), new LocalEmbeddingProvider());

  try {
    console.log("seeding the product room (downloads a small embedding model the first time)…");
    const result = await runDemo(core, DEMO_INTERVIEW);
    console.log(`hero decision: ${result.decision.title}`);
    await widenTheRoom(core);

    console.log("seeding drift catches…");
    await seedCatches(core);

    console.log("wiring connectors + state…");
    await seedConnectors(store, pool);

    console.log("writing the observability history…");
    await seedObservability(pool);

    const open = await core.getOpenQuestions();
    const decided = await core.getDecisions({ status: "decided" });
    const entities = await core.listEntities();
    const runs = await store.listRuns({ limit: 1000 });
    const connectors = await store.listConnectorState();
    console.log(
      `done. decided ${decided.length} · open ${open.length} · entities ${entities.length} · ` +
        `connectors ${connectors.length} · runs ${runs.length}`,
    );
  } finally {
    await pool.end();
    await store.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error: unknown) => {
    console.error("seed-console failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
