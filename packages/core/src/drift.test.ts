import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { type DiffHunk, parseGitDiff, readGitDiff, readRepoCode } from "./drift.js";
import { Marrow } from "./marrow.js";
import { Store } from "./store.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";
const here = dirname(fileURLToPath(import.meta.url));
const human = { value: 1, source: "human" as const };

let store: Store;
let core: Marrow;
let admin: pg.Pool;

function hunk(path: string, newLines: string, lineStart = 1): DiffHunk {
  return {
    path,
    lineStart,
    lineEnd: lineStart + newLines.split("\n").length - 1,
    oldLines: "",
    newLines,
    hunkHeader: "@@ -0,0 +1,1 @@",
  };
}

async function seedDecided(title: string): Promise<string> {
  const ev = await store.insertEvidence({ text: title, source: "interviews/x.md" });
  const decision = await store.insertDecision({
    title,
    rationale: "",
    constraint: false,
    status: "decided",
    confidence: human,
    provenance: [{ evidenceId: ev.id, start: 0, end: Math.min(10, title.length) }],
  });
  return decision.id;
}

async function seedDecidedGoal(title: string, description = ""): Promise<string> {
  const text = description ? `${title} ${description}` : title;
  const ev = await store.insertEvidence({ text, source: "goals/x.md" });
  const goal = await store.insertGoal({
    title,
    ...(description ? { description } : {}),
    goalType: "product",
    status: "decided",
    confidence: human,
    provenance: [{ evidenceId: ev.id, start: 0, end: Math.min(10, title.length) }],
  });
  return goal.id;
}

beforeAll(() => {
  execFileSync("node", [join(here, "..", "scripts", "migrate.mjs")], {
    env: { ...process.env, DATABASE_URL },
    stdio: "ignore",
  });
  store = new Store(DATABASE_URL);
  core = new Marrow(store);
  admin = new pg.Pool({ connectionString: DATABASE_URL });
});

afterAll(async () => {
  await store.close();
  await admin.end();
});

beforeEach(async () => {
  await admin.query(
    "truncate catch_events, provenance, embedding, entity, decision, question, goal restart identity cascade",
  );
});

describe("drift detection", () => {
  it("raises a question when code contradicts a decided fact", async () => {
    const decisionId = await seedDecided("magic links only, no passwords");
    const result = await core.driftScan(".", {
      hunks: [hunk("src/auth.ts", "const passwordHash = hash(password);")],
      semantic: false,
      trigger: "test",
    });

    expect(result.created.length).toBeGreaterThan(0);
    expect(result.created.every((n) => n.status !== "decided")).toBe(true);
    expect(result.events.length).toBe(result.created.length);

    const questions = await core.getOpenQuestions();
    expect(questions.some((q) => (q.relatesTo ?? []).includes(decisionId))).toBe(true);
    expect((await core.getNode(decisionId))?.status).toBe("decided");

    const events = await store.listCatchEvents({ decisionId });
    expect(events.some((e) => e.event_type === "catch_surfaced")).toBe(true);
  });

  it("a re-run on the same unresolved diff stays red: the open catch is reported, not laundered", async () => {
    await seedDecided("magic links only, no passwords");
    const hunks = [hunk("src/auth.ts", "const passwordHash = hash(password);")];
    const first = await core.driftScan(".", { hunks, semantic: false, trigger: "test" });
    expect(first.created.length).toBeGreaterThan(0);
    const question = first.created.find((n) => n.kind === "question");
    expect(question).toBeDefined();

    // the identical diff again: dedupe stops a duplicate catch, but the open
    // violation must still count. this exact re-run used to go green.
    const second = await core.driftScan(".", { hunks, semantic: false, trigger: "test" });
    expect(second.created).toHaveLength(0);
    expect(second.openMatches.length).toBeGreaterThan(0);
    expect(second.openMatches.map((m) => m.questionId)).toContain(question?.id);
    expect(second.openMatches[0]?.path).toBe("src/auth.ts");

    // once a human resolves the catch, the same diff goes quiet.
    if (question) await core.dismissCatch(question.id, "intentional exception");
    const third = await core.driftScan(".", { hunks, semantic: false, trigger: "test" });
    expect(third.created).toHaveLength(0);
    expect(third.openMatches).toHaveLength(0);
  });

  it("can be turned off with one flag", async () => {
    await seedDecided("magic links only, no passwords");
    const result = await core.driftScan(".", {
      hunks: [hunk("src/auth.ts", "const passwordHash = hash(password);")],
      enabled: false,
    });
    expect(result.created).toHaveLength(0);
    expect(result.events).toHaveLength(0);
  });

  it("does not raise a question when code is consistent", async () => {
    await seedDecided("use Stripe for billing");
    const result = await core.driftScan(".", {
      hunks: [hunk("src/billing.ts", "const stripeCustomerId = customer.id;")],
      semantic: false,
    });
    expect(result.created).toHaveLength(0);
  });

  it("records precise file/line provenance on surfaced catches", async () => {
    await seedDecided("magic links only, no passwords");
    const result = await core.driftScan(".", {
      hunks: [hunk("src/auth.ts", "const passwordHash = hash(password);", 42)],
      semantic: false,
    });
    const question = result.created[0];
    expect(question?.kind).toBe("question");
    if (question?.kind !== "question") return;
    const trace = await core.traceToSource(question.id);
    expect(trace.spans[0]?.source).toMatch(/src\/auth\.ts:42-/);
  });
});

describe("goal drift", () => {
  it("captures evidence, a question and a catch event, and never touches the goal", async () => {
    const goalId = await seedDecidedGoal(
      "passwordless product, no passwords ever",
      "every user logs in with a magic link",
    );
    const before = await core.getNode(goalId);
    expect(before?.kind).toBe("goal");

    const result = await core.driftScan(".", {
      hunks: [hunk("src/auth.ts", "const passwordHash = hash(password);", 7)],
      semantic: false,
      trigger: "test",
    });

    // 1. a question relating to the goal was raised, none decided.
    expect(result.created.length).toBeGreaterThan(0);
    expect(result.created.every((n) => n.status !== "decided")).toBe(true);
    const question = result.created.find((n) => n.kind === "question");
    expect(question).toBeDefined();
    if (question?.kind !== "question") return;
    expect(question.relatesTo ?? []).toContain(goalId);

    // 2. the hunk was captured as immutable evidence with file:line provenance.
    const trace = await core.traceToSource(question.id);
    expect(trace.spans[0]?.source).toMatch(/src\/auth\.ts:7-/);

    // 3. a catch event was recorded against the question (no goal_id column).
    expect(result.events.length).toBe(result.created.length);
    const events = await store.listCatchEvents({ questionId: question.id });
    expect(events.some((e) => e.event_type === "catch_surfaced")).toBe(true);

    // 4. PROOF of no-code-memory: the decided goal is untouched by the scan.
    const after = await core.getNode(goalId);
    expect(after?.kind).toBe("goal");
    if (before?.kind !== "goal" || after?.kind !== "goal") return;
    expect(after.status).toBe("decided");
    expect(after.title).toBe(before.title);
    expect(after.description).toBe(before.description);
    expect(after.confidence.value).toBe(before.confidence.value);
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it("a goal drift catch ranks below a decision drift catch on the same hunk", async () => {
    await seedDecidedGoal("no passwords ever", "magic links only");
    await seedDecided("no passwords, magic links only");
    const { events } = await core.driftScan(".", {
      hunks: [hunk("src/auth.ts", "const passwordHash = hash(password);", 3)],
      semantic: false,
    });
    const surfaced = await store.listCatchEvents({ eventType: "catch_surfaced" });
    const goalEvent = surfaced.find((e) => e.decision_id === null);
    const decisionEvent = surfaced.find((e) => e.decision_id !== null);
    expect(events.length).toBe(2);
    expect(goalEvent?.confidence).toBeDefined();
    expect(decisionEvent?.confidence).toBeDefined();
    expect(goalEvent!.confidence!).toBeLessThan(decisionEvent!.confidence!);
  });

  it("only decided goals are scanned, not open ones", async () => {
    const ev = await store.insertEvidence({ text: "no passwords ever", source: "goals/o.md" });
    await store.insertGoal({
      title: "no passwords ever",
      goalType: "product",
      status: "open",
      confidence: { value: 0.6, source: "model" },
      provenance: [{ evidenceId: ev.id, start: 0, end: 10 }],
    });
    const result = await core.driftScan(".", {
      hunks: [hunk("src/auth.ts", "const passwordHash = hash(password);")],
      semantic: false,
    });
    expect(result.created).toHaveLength(0);
  });
});

describe("git diff parser", () => {
  it("parses a simple unstaged diff into hunks", () => {
    const diff = `diff --git a/src/auth.ts b/src/auth.ts
index 1234..5678 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,3 +1,4 @@
 export function login() {
+  const passwordHash = hash(password);
   return token;
 }
`;
    const hunks = parseGitDiff(diff);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.path).toBe("src/auth.ts");
    expect(hunks[0]?.lineStart).toBe(2);
    expect(hunks[0]?.newLines).toContain("const passwordHash = hash(password);");
  });

  it("returns empty array when there is no diff", () => {
    expect(parseGitDiff("")).toHaveLength(0);
  });

  it("parses diffs with quoted paths containing spaces", () => {
    const diff = `diff --git "a/src/auth service.ts" "b/src/auth service.ts"
index 1234..5678 100644
--- "a/src/auth service.ts"
+++ "b/src/auth service.ts"
@@ -1,2 +1,3 @@
 export function login() {
+  const passwordHash = hash(password);
 }
`;
    const hunks = parseGitDiff(diff);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.path).toBe("src/auth service.ts");
  });

  it("reads unstaged and staged hunks from an isolated git repo", async () => {
    const repo = await mkdtemp(join(tmpdir(), "marrow-drift-"));
    execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Marrow Test"], { cwd: repo });
    await writeFile(join(repo, "auth.ts"), "export function login() {\n  return token;\n}\n");
    execFileSync("git", ["add", "auth.ts"], { cwd: repo });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: repo, stdio: "ignore" });

    await writeFile(
      join(repo, "auth.ts"),
      "export function login() {\n  const passwordHash = hash(password);\n  return token;\n}\n",
    );

    const unstaged = await readGitDiff(repo, "unstaged");
    expect(unstaged).toHaveLength(1);
    expect(unstaged[0]?.path).toBe("auth.ts");
    expect(unstaged[0]?.lineStart).toBe(2);
    expect(unstaged[0]?.newLines).toContain("passwordHash");

    execFileSync("git", ["add", "auth.ts"], { cwd: repo });
    expect(await readGitDiff(repo, "unstaged")).toHaveLength(0);

    const staged = await readGitDiff(repo, "staged");
    expect(staged).toHaveLength(1);
    expect(staged[0]?.newLines).toContain("passwordHash");
  });

  it("fails loud when drift is pointed at a non-git directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "marrow-no-git-"));
    await expect(readGitDiff(dir, "unstaged")).rejects.toThrow(/not a git repo.*git init/i);
  });

  it("does not resurface a dismissed catch", async () => {
    await seedDecided("magic links only, no passwords");
    const { created } = await core.driftScan(".", {
      hunks: [hunk("src/auth.ts", "const passwordHash = hash(password);")],
      semantic: false,
    });
    expect(created).toHaveLength(1);
    const question = created[0];
    expect(question?.kind).toBe("question");
    if (question?.kind !== "question") return;

    await core.dismissCatch(question.id, "this is a test file, not production code");
    const second = await core.driftScan(".", {
      hunks: [hunk("src/auth.ts", "const passwordHash = hash(password);")],
      semantic: false,
    });
    expect(second.created).toHaveLength(0);

    const round = await store.getQuestion(question.id);
    expect(round?.status).toBe("dismissed");
  });

  it("surfaces each hunk that contradicts the same decision", async () => {
    await seedDecided("magic links only, no passwords");
    const { created } = await core.driftScan(".", {
      hunks: [
        hunk("src/auth.ts", "const passwordHash = hash(password);", 10),
        hunk("src/login.ts", "if (password) { /* ... */ }", 20),
      ],
      semantic: false,
    });
    expect(created).toHaveLength(2);
  });
});

describe("legacy repo code reader", () => {
  it("reads only supported code files and skips ignored paths", async () => {
    const repo = await mkdtemp(join(tmpdir(), "marrow-repo-code-"));
    await mkdir(join(repo, "src"), { recursive: true });
    await mkdir(join(repo, "node_modules", "pkg"), { recursive: true });
    await mkdir(join(repo, "dist"), { recursive: true });

    await writeFile(join(repo, "src", "auth.ts"), "const loginDecision = 'magic links';");
    await writeFile(join(repo, "src", "notes.md"), "product truth should not come from docs");
    await writeFile(join(repo, ".env"), "SECRET=do-not-read");
    await writeFile(join(repo, "node_modules", "pkg", "index.js"), "const dependency = true;");
    await writeFile(join(repo, "dist", "bundle.js"), "const built = true;");

    const out = await readRepoCode(repo);

    expect(out).toContain("loginDecision");
    expect(out).not.toContain("product truth should not come from docs");
    expect(out).not.toContain("SECRET=do-not-read");
    expect(out).not.toContain("dependency = true");
    expect(out).not.toContain("built = true");
  });
});

describe("catch disposition", () => {
  it("accepts a catch and records catch_acted_on", async () => {
    const decisionId = await seedDecided("magic links only, no passwords");
    const { created } = await core.driftScan(".", {
      hunks: [hunk("src/auth.ts", "const passwordHash = hash(password);")],
      semantic: false,
    });
    const question = created[0];
    expect(question?.kind).toBe("question");
    if (question?.kind !== "question") return;

    const updated = await core.acceptCatch(question.id, "reverting the password branch now");
    expect(updated.status).toBe("decided");
    expect(updated.provenance).toHaveLength(2);

    const events = await store.listCatchEvents({ decisionId, eventType: "catch_acted_on" });
    expect(events).toHaveLength(1);
  });

  it("records catch_acted_on when a drift question is answered from the question loop", async () => {
    const decisionId = await seedDecided("magic links only, no passwords");
    const { created } = await core.driftScan(".", {
      hunks: [hunk("src/auth.ts", "const passwordHash = hash(password);")],
      semantic: false,
    });
    const question = created[0];
    expect(question?.kind).toBe("question");
    if (question?.kind !== "question") return;

    await core.answer(question.id, "removed the password branch");

    const updated = await store.getQuestion(question.id);
    expect(updated?.status).toBe("superseded");

    const events = await store.listCatchEvents({ questionId: question.id });
    const actedOn = events.find((e) => e.event_type === "catch_acted_on");
    expect(actedOn?.decision_id).toBe(decisionId);
    expect(actedOn?.trigger).toBe("question_loop");
  });

  it("rejects accepting a non-drift question", async () => {
    const ev = await store.insertEvidence({ text: "x", source: "t" });
    const q = await store.insertQuestion({
      prompt: "what about auth?",
      status: "open",
      confidence: { value: 0.5, source: "model" },
      provenance: [{ evidenceId: ev.id, start: 0, end: 1 }],
    });
    await expect(core.acceptCatch(q.id, "fixed")).rejects.toThrow(/not a drift catch/);
  });

  it("reports catch metrics excluding synthetics", async () => {
    const decisionId = await seedDecided("magic links only, no passwords");
    await core.driftScan(".", {
      hunks: [hunk("src/auth.ts", "const passwordHash = hash(password);")],
      semantic: false,
      synthetic: true,
    });
    await core.driftScan(".", {
      hunks: [hunk("src/billing.ts", "if (password) {}")],
      semantic: false,
      synthetic: false,
    });

    const metrics = await core.catchMetrics();
    expect(metrics.surfaced).toBe(1);
    expect(metrics.dismissRate).toBe(0);

    const all = await core.catchMetrics({ includeSynthetic: true });
    expect(all.surfaced).toBe(2);

    const questions = await core.getOpenQuestions();
    const q = questions.find((x) => (x.relatesTo ?? []).includes(decisionId));
    if (q) {
      await core.dismissCatch(q.id, "test");
      const afterDismiss = await core.catchMetrics();
      expect(afterDismiss.dismissed).toBe(1);
      expect(afterDismiss.dismissRate).toBe(1);
      expect(afterDismiss.precision).toBe(0);
    }
  });

  it("renders a sanitized catch receipt", async () => {
    await seedDecided("auth uses magic links, no passwords");
    const { created } = await core.driftScan(".", {
      hunks: [hunk("src/auth.ts", "const passwordHash = hash(password);")],
      semantic: false,
    });
    const question = created[0];
    if (question?.kind !== "question") throw new Error("expected question");

    const receipt = await core.renderCatchReceipt(question.id);
    expect(receipt.decisionTitle).toContain("magic links");
    expect(receipt.path).toBe("src/auth.ts");
    expect(receipt.lineStart).toBeDefined();
    expect(receipt.sourceLabel).toMatch(/evidence/);
  });
});
