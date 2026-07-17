// Seed a hosted demo brain. Run once against the Supabase DIRECT connection
// (port 5432), not the transaction pooler, because it runs DDL (migrations) and
// a multi-step distill. The serverless runtime uses the pooler separately.
//
//   DATABASE_URL=<supabase-direct-url> npx tsx packages/web/scripts/seed-demo.ts
//
// It applies the core migrations, runs the hero slice (ingest the interview,
// distill it, answer the loop, the launch-auth decision becomes decided with provenance back
// to the exact line), then widens the brain into a believable product room:
// more meetings as immutable evidence, decisions proposed with verbatim-quote
// spans, some promoted to decided through the answer loop, one conflict left
// open so the picker shows. Idempotent enough to run on a fresh database;
// re-running on a populated one would append (evidence is immutable), so seed
// once.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEMO_INTERVIEW,
  LocalEmbeddingProvider,
  Marrow,
  Store,
  createDemoModel,
  runDemo,
  type DiffHunk,
} from "@marrowhq/core";

import { widenTheRoom } from "./seed-room.js";

/**
 * Make the demo brain inhabited by operations that ACTUALLY happened, never
 * invented figures. Every run this records is a genuine search or drift scan the
 * demo brain performed while it was seeded, so /observability, /catches and
 * /goals show real activity a prospect can trust. Connectors stay empty on
 * purpose: this brain was fed from files, and the demo says so rather than
 * faking live Slack/Jira syncs.
 */
async function seedDemoActivity(core: Marrow): Promise<void> {
  // 1. Real agent-style retrieval. Each is a genuine search run, the task-scoped
  //    context a coding agent pulls before it builds.
  const queries = [
    "trial length policy",
    "does the editor work offline",
    "overage billing cap or charge",
    "per workspace pricing",
    "presence in the editor",
  ];
  for (const q of queries) await core.search(q, 5);

  // 2. Two goals the room committed to, the human-authored path. Real commitments
  //    from the seeded product room, each cited to its own goal statement.
  const entities = await core.listEntities();
  const entityId = (needle: string): string | undefined =>
    entities.find((e) => e.name.toLowerCase().includes(needle))?.id;
  const trialEntity = entityId("trial");
  const pricingEntity = entityId("pricing");
  await core.authorGoal({
    title: "A team reaches the aha moment inside the trial",
    description:
      "Activation takes two weekends, so the trial has to outlast that or teams go cold before they convert.",
    goalType: "user",
    ...(trialEntity ? { entityId: trialEntity } : {}),
    source: "goals/activation.md",
  });
  await core.authorGoal({
    title: "One predictable price per workspace",
    description:
      "Flat per workspace, no per-seat metering. The founders want one number they can forecast.",
    goalType: "product",
    ...(pricingEntity ? { entityId: pricingEntity } : {}),
    source: "goals/pricing.md",
  });

  // 3. A real drift scan. The card wall contradicts the decided "free trial, no
  //    card upfront" fact, the exact drift the landing dramatizes, so the Catches
  //    tab shows a genuine detection tracing back to the room, not a mock.
  const hunks: DiffHunk[] = [
    {
      path: "src/signup/card-wall.ts",
      lineStart: 12,
      lineEnd: 18,
      oldLines: "",
      newLines: `// block the trial until a card is on file
export async function requireCardAtSignup(customerId: string): Promise<SetupIntent> {
  return stripe.setupIntents.create({ customer: customerId, usage: "off_session" });
}`,
      hunkHeader: "@@ -12,0 +12,4 @@",
    },
    {
      path: "src/editor/sync.ts",
      lineStart: 24,
      lineEnd: 30,
      oldLines: "",
      newLines: `export function saveDocument(docId: string, content: string): void {
  if (!navigator.onLine) {
    throw new Error("cannot save while offline");
  }
  fetch("/api/documents", { method: "POST", body: JSON.stringify({ id: docId, content }) });
}`,
      hunkHeader: "@@ -24,0 +24,4 @@",
    },
  ];
  // The card-wall drift stays an open catch: it is the story the landing points
  // at, and the human acting on it is the whole point of the loop. We leave it
  // for the visitor to see, we do not resolve it in the seed.
  await core.driftScan("demo-repo", { hunks, semantic: false, synthetic: false });
}

const here = dirname(fileURLToPath(import.meta.url));
const migrate = join(here, "..", "..", "core", "scripts", "migrate.mjs");

// ---- The room lives in seed-room.ts, shared with the console seed so the two
// never drift. The hero interview is core's DEMO_INTERVIEW, so `npx marrow
// demo`, this seed and the landing page all quote one transcript. ----

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("seed-demo: set DATABASE_URL to the Supabase direct connection (port 5432).");
    process.exit(1);
  }

  console.log("applying migrations…");
  execFileSync("node", [migrate], { env: process.env, stdio: "inherit" });

  console.log("seeding the demo brain (downloads a small embedding model the first time)…");
  const store = new Store(url);
  try {
    const core = new Marrow(store, createDemoModel(), new LocalEmbeddingProvider());
    const result = await runDemo(core, DEMO_INTERVIEW);
    console.log(`decided: ${result.decision.title}  (${result.decisionId})`);

    console.log("widening the room…");
    await widenTheRoom(core);

    console.log("recording real activity (searches, goals, a drift scan)…");
    await seedDemoActivity(core);

    const open = await core.getOpenQuestions();
    const decided = await core.getDecisions({ status: "decided" });
    const goals = await store.listGoals();
    const runs = await store.listRuns({ limit: 200 });
    console.log(
      `decided: ${decided.length} · open questions: ${open.length} · goals: ${goals.length} · runs: ${runs.length}`,
    );
    console.log("Done. The brain holds a real product room.");
  } finally {
    await store.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error: unknown) => {
    console.error("seed-demo failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
