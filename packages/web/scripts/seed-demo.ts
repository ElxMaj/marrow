// Seed a hosted demo brain. Run once against the Supabase DIRECT connection
// (port 5432), not the transaction pooler, because it runs DDL (migrations) and
// a multi-step distill. The serverless runtime uses the pooler separately.
//
//   DATABASE_URL=<supabase-direct-url> npx tsx packages/web/scripts/seed-demo.ts
//
// It applies the core migrations, runs the hero slice (ingest the interview,
// distill it, answer the loop, soft delete becomes decided with provenance back
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
} from "@marrowhq/core";

import { widenTheRoom } from "./seed-room.js";

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

    const open = await core.getOpenQuestions();
    const decided = await core.getDecisions({ status: "decided" });
    console.log(`decided: ${decided.length} · open questions: ${open.length}`);
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
