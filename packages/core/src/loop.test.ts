import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Marrow } from "./marrow.js";
import { questionImpact } from "./loop.js";
import {
  type EmbeddingProvider,
  type EmbeddingResult,
  type ModelProvider,
} from "./providers/types.js";
import { Store } from "./store.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marrow:marrow@localhost:5432/marrow";
const here = dirname(fileURLToPath(import.meta.url));

const span = (text: string, phrase: string) => {
  const start = text.indexOf(phrase);
  if (start < 0) throw new Error(`phrase not found: ${phrase}`);
  return { start, end: start + phrase.length };
};
const hunk = (path: string, newLines: string, lineStart = 1) => ({
  path,
  lineStart,
  lineEnd: lineStart + newLines.split("\n").length - 1,
  oldLines: "",
  newLines,
  hunkHeader: "@@ -0,0 +1,1 @@",
});
const decisionExtraction = (text: string, title: string) => ({
  decisions: [{ title, rationale: "", ...span(text, title) }],
});
const entityExtraction = (text: string, name: string) => ({
  entities: [{ name, ...span(text, name) }],
});

class ScriptedModel implements ModelProvider {
  readonly model = "scripted";
  private queue: unknown[] = [];
  push(extraction: unknown): this {
    this.queue.push(extraction);
    return this;
  }
  reset(): void {
    this.queue = [];
  }
  complete(): Promise<string> {
    return Promise.resolve(JSON.stringify(this.queue.shift() ?? {}));
  }
}

class FakeEmbedding implements EmbeddingProvider {
  readonly model = "fake-emb";
  embed(texts: string[]): Promise<EmbeddingResult> {
    return Promise.resolve({ vectors: texts.map(() => [0, 0, 0, 0]), model: this.model, dim: 4 });
  }
}

let store: Store;
let core: Marrow;
let model: ScriptedModel;
let admin: pg.Pool;

const human = { value: 1, source: "human" as const };
const modelConf = { value: 0.6, source: "model" as const };

beforeAll(() => {
  process.env["MARROW_SECRET_KEY"] = process.env["MARROW_SECRET_KEY"] ?? "test-loop-secret-key";
  execFileSync("node", [join(here, "..", "scripts", "migrate.mjs")], {
    env: { ...process.env, DATABASE_URL },
    stdio: "ignore",
  });
  store = new Store(DATABASE_URL);
  model = new ScriptedModel();
  core = new Marrow(store, model, new FakeEmbedding());
  admin = new pg.Pool({ connectionString: DATABASE_URL });
});

afterAll(async () => {
  await store.close();
  await admin.end();
});

beforeEach(async () => {
  model.reset();
  await admin.query(
    "truncate catch_events, provenance, embedding, entity, decision, question, goal restart identity cascade",
  );
});

// the invariant: a DECISION is promoted to decided only through answer. a drift
// catch (a question) may be marked decided by acceptCatch when a human acts on
// it; that is not promoting a Decision, so it does not count here.
function decidedWriters(): string[] {
  const storeSrc = readFileSync(join(here, "store.ts"), "utf8");
  const writes = [...storeSrc.matchAll(/set status = 'decided'/g)];
  expect(writes).toHaveLength(1); // exactly one write site: promoteToDecided
  const marrowSrc = readFileSync(join(here, "marrow.ts"), "utf8");
  const methods = [...marrowSrc.matchAll(/^ {2}(?:async )?(\w+)\s*\(/gm)];
  const writers = new Set<string>();
  for (const call of marrowSrc.matchAll(/promoteToDecided\([^,]+,\s*([^,]+),/g)) {
    // skip a promotion whose kind argument is the literal "question": that is a
    // catch resolution, not a Decision reaching decided.
    if ((call[1] ?? "").trim() === '"question"') continue;
    const at = call.index ?? 0;
    let name = "?";
    for (const m of methods) {
      if ((m.index ?? 0) < at) name = m[1] ?? name;
      else break;
    }
    writers.add(name);
  }
  return [...writers];
}

async function seedConflict(): Promise<{ questionId: string; newDecisionId: string }> {
  const ev = await store.insertEvidence({ text: "auth uses passwords today", source: "legacy" });
  await store.insertDecision({
    title: "auth uses passwords",
    rationale: "legacy shared login",
    constraint: false,
    status: "decided",
    confidence: human,
    provenance: [{ evidenceId: ev.id, start: 0, end: 19 }],
  });
  const text = "we decided magic links, no passwords from now on";
  model.push(decisionExtraction(text, "magic links, no passwords"));
  await core.ingestAndDistill({ text, source: "interviews/c.md" });
  const conflict = (await core.getOpenQuestions()).find((q) =>
    /conflict|contradict/i.test(q.prompt),
  );
  if (!conflict) throw new Error("expected a conflict question");
  const newDecisionId = (conflict.relatesTo ?? [])[0];
  if (!newDecisionId) throw new Error("conflict question missing relatesTo");
  return { questionId: conflict.id, newDecisionId };
}

async function seedAnswerableDecision(
  title: string,
): Promise<{ decisionId: string; questionId: string }> {
  const ev = await store.insertEvidence({ text: title, source: `answers/${title}` });
  const provenance = [{ evidenceId: ev.id, start: 0, end: title.length }];
  const decision = await store.insertDecision({
    title,
    rationale: "",
    constraint: false,
    status: "open",
    confidence: modelConf,
    provenance,
  });
  const question = await store.insertQuestion({
    prompt: `confirm ${title}?`,
    relatesTo: [decision.id],
    status: "open",
    confidence: modelConf,
    provenance,
  });
  return { decisionId: decision.id, questionId: question.id };
}

describe("question loop", () => {
  it("decided is reachable only through answer", () => {
    expect(decidedWriters()).toEqual(["answer"]);
  });

  it("proposeNode always creates open model-confidence nodes, ignoring attempted decided status", async () => {
    const ev = await store.insertEvidence({
      text: "magic link auth needs no passwords",
      source: "standups/propose.md",
    });
    const provenance = [{ evidenceId: ev.id, start: 0, end: "magic link auth".length }];

    const entity = await core.proposeNode({
      kind: "entity",
      name: "magic link auth",
      provenance,
      confidence: 0.7,
    });
    const attemptedDecidedDecision = {
      kind: "decision" as const,
      title: "Magic links only",
      provenance,
      status: "decided" as const,
    };
    const decision = await core.proposeNode(attemptedDecidedDecision);
    const attemptedDecidedQuestion = {
      kind: "question" as const,
      prompt: "Confirm magic links only?",
      relatesTo: [decision.id],
      provenance,
      status: "decided" as const,
    };
    const question = await core.proposeNode(attemptedDecidedQuestion);

    expect(entity).toMatchObject({
      kind: "entity",
      status: "open",
      confidence: { value: 0.7, source: "model" },
      provenance,
    });
    expect(decision).toMatchObject({
      kind: "decision",
      status: "open",
      confidence: { value: 0.5, source: "model" },
      provenance,
    });
    expect(question).toMatchObject({
      kind: "question",
      status: "open",
      confidence: { value: 0.5, source: "model" },
      provenance,
    });
  });

  it("answerBatch processes entries in order and aggregates promoted nodes", async () => {
    const first = await seedAnswerableDecision("Magic links stay passwordless");
    const second = await seedAnswerableDecision("Billing webhooks retry with backoff");

    const result = await core.answerBatch([
      { questionId: first.questionId, text: "yes, passwordless stays" },
      { questionId: second.questionId, text: "yes, retry with backoff" },
    ]);

    expect(result.promoted.map((node) => node.id)).toEqual([first.decisionId, second.decisionId]);
    expect(result.superseded).toEqual([]);
    expect((await core.getNode(first.decisionId))?.status).toBe("decided");
    expect((await core.getNode(second.decisionId))?.status).toBe("decided");
  });

  it("answerBatch stops on failure while keeping earlier committed answers", async () => {
    const first = await seedAnswerableDecision("Audit exports include actor id");
    const second = await seedAnswerableDecision("Usage billing exports invoices");

    await expect(
      core.answerBatch([
        { questionId: first.questionId, text: "yes, include actor id" },
        { questionId: "q_missing", text: "this should fail" },
        { questionId: second.questionId, text: "this should not run" },
      ]),
    ).rejects.toThrow(/not found/);

    expect((await core.getNode(first.decisionId))?.status).toBe("decided");
    expect((await core.getNode(second.decisionId))?.status).toBe("open");
    expect((await core.getOpenQuestions()).map((q) => q.id)).toContain(second.questionId);
  });

  it("orders open questions by impact: a contested decision outranks a gap", async () => {
    await seedConflict();
    const gapText = "the billing webhooks integration was mentioned in passing";
    model.push(entityExtraction(gapText, "billing webhooks"));
    await core.ingestAndDistill({ text: gapText, source: "standups/g.md" });

    const questions = await core.getOpenQuestions();
    expect(questions.length).toBeGreaterThanOrEqual(2);
    const first = questions[0];
    const last = questions[questions.length - 1];
    if (!first || !last) throw new Error("expected questions");
    expect(/conflict|contradict/i.test(first.prompt)).toBe(true);
    expect(questionImpact(first)).toBe(3);
    expect(questionImpact(last)).toBeLessThan(3);
  });

  it("answering a conflict promotes only the chosen decision and supersedes the other", async () => {
    const { questionId, newDecisionId } = await seedConflict();
    await core.answer(questionId, "magic links win, drop passwords", { decide: newDecisionId });
    const chosen = await core.getDecision(newDecisionId);
    expect(chosen?.status).toBe("decided");
    expect(chosen?.confidence.source).toBe("human");
    // the contradicted prior decision is superseded, never left decided.
    const others = (await core.getDecisions()).filter((d) => d.id !== newDecisionId);
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((d) => d.status === "superseded")).toBe(true);
  });

  it("refuses to answer a conflict without a choice, promoting neither side", async () => {
    const { questionId, newDecisionId } = await seedConflict();
    await expect(core.answer(questionId, "hmm")).rejects.toThrow(
      /which one holds|decide|relates to/i,
    );
    // nothing was promoted and the question is still open to answer properly.
    const chosen = await core.getDecision(newDecisionId);
    expect(chosen?.status).not.toBe("decided");
    expect((await core.getOpenQuestions()).some((q) => q.id === questionId)).toBe(true);
  });

  it("refuses to re-answer a question that is already closed", async () => {
    const { questionId, newDecisionId } = await seedConflict();
    await core.answer(questionId, "magic links win", { decide: newDecisionId });
    await expect(core.answer(questionId, "again", { decide: newDecisionId })).rejects.toThrow(
      /already|not open/i,
    );
  });

  it("flags two contradictions in the SAME room, before anything is decided", async () => {
    const text =
      "Option A: keep passwords for the shared desk. Option B: no passwords, switch to magic links.";
    model.push({
      decisions: [
        {
          title: "keep passwords for the shared desk",
          quote: "keep passwords for the shared desk",
        },
        {
          title: "no passwords, switch to magic links",
          quote: "no passwords, switch to magic links",
        },
      ],
    });
    await core.ingestAndDistill({ text, source: "standups/same-room.md" });

    const conflict = (await core.getOpenQuestions()).find((q) =>
      /conflict|contradict/i.test(q.prompt),
    );
    if (!conflict) throw new Error("expected a same-room conflict question");
    expect((conflict.relatesTo ?? []).length).toBe(2);
    // neither side is auto-resolved: both stay open until a human picks one.
    const decisions = await core.getDecisions();
    expect(decisions.every((d) => d.status !== "decided")).toBe(true);
  });

  it("answering can spawn a follow-up conflict question", async () => {
    const ev = await store.insertEvidence({ text: "we discussed sessions", source: "s" });
    const c = await store.insertDecision({
      title: "sessions never expire",
      rationale: "convenience",
      constraint: false,
      status: "decided",
      confidence: human,
      provenance: [{ evidenceId: ev.id, start: 0, end: 8 }],
    });
    const b = await store.insertDecision({
      title: "sessions expire after fifteen minutes",
      rationale: "shared terminal",
      constraint: false,
      status: "open",
      confidence: modelConf,
      provenance: [{ evidenceId: ev.id, start: 0, end: 8 }],
    });
    const q = await store.insertQuestion({
      prompt: "should sessions expire?",
      relatesTo: [b.id],
      status: "open",
      confidence: modelConf,
      provenance: [{ evidenceId: ev.id, start: 0, end: 8 }],
    });

    await core.answer(q.id, "yes, sessions expire after fifteen minutes on a shared terminal");

    const followups = (await core.getOpenQuestions()).filter((x) =>
      /follow-up conflict/i.test(x.prompt),
    );
    expect(
      followups.some(
        (f) => (f.relatesTo ?? []).includes(b.id) && (f.relatesTo ?? []).includes(c.id),
      ),
    ).toBe(true);
  });
});

describe("agent decision gate and truth maintenance", () => {
  async function seedPasswordTruth() {
    const text =
      "Dana: We decided magic links, no passwords. Password login is explicitly out for launch.";
    const ev = await store.insertEvidence({ text, source: "interviews/auth.md" });
    const start = text.indexOf("magic links, no passwords");
    const decision = await store.insertDecision({
      title: "Auth uses magic links, no passwords",
      rationale: "password login is out for launch",
      constraint: true,
      status: "decided",
      confidence: human,
      provenance: [{ evidenceId: ev.id, start, end: start + "magic links, no passwords".length }],
    });
    const goal = await store.insertGoal({
      title: "Users sign in without password setup",
      goalType: "user",
      status: "decided",
      confidence: human,
      provenance: [{ evidenceId: ev.id, start: 0, end: text.length }],
    });
    const question = await store.insertQuestion({
      prompt: "Do admins need a recovery path without passwords?",
      relatesTo: [decision.id],
      status: "open",
      confidence: modelConf,
      provenance: [{ evidenceId: ev.id, start: 0, end: 4 }],
    });
    await store.insertDecision({
      title: "Billing stays on Stripe",
      rationale: "",
      constraint: false,
      status: "decided",
      confidence: human,
      provenance: [{ evidenceId: ev.id, start: 0, end: 4 }],
    });
    return { decision, goal, question };
  }

  it("prepareTask returns a compact task brief with decided facts, open questions and exact spans", async () => {
    const { decision, question } = await seedPasswordTruth();
    const brief = await core.prepareTask("implement password login");

    expect(brief.task).toBe("implement password login");
    expect(brief.status).toBe("ask_human_first");
    expect(brief.safeToBuild.facts.map((f) => f.id)).toContain(decision.id);
    expect(brief.safeToBuild.facts.map((f) => f.title)).not.toContain("Billing stays on Stripe");
    const fact = brief.safeToBuild.facts.find((f) => f.id === decision.id);
    expect(fact?.status).toBe("decided");
    expect(fact?.provenance[0]).toMatchObject({
      source: "interviews/auth.md",
      spanText: "magic links, no passwords",
    });
    expect(brief.askHumanFirst.questions.map((q) => q.id)).toContain(question.id);
    expect(brief.askHumanFirst.questions[0]?.status).toBe("open");
    expect(brief.askHumanFirst.questions[0]?.provenance[0]?.spanText).toBe("Dana");
    expect(brief.safeToBuild.facts.length).toBeLessThanOrEqual(6);
    expect(brief.askHumanFirst.questions.length).toBeLessThanOrEqual(6);
  });

  it("prepareTask check mode runs drift, creates catch events, receipts and next commands", async () => {
    await seedPasswordTruth();
    const brief = await core.prepareTask("implement password login", {
      check: true,
      repoPath: ".",
      semantic: false,
      hunks: [hunk("src/auth.ts", "const passwordHash = hash(password);", 12)],
    });

    expect(brief.check?.createdDriftQuestions.length).toBeGreaterThan(0);
    expect(brief.check?.catchEventIds.length).toBe(brief.check?.createdDriftQuestions.length);
    expect(brief.check?.receiptData[0]).toMatchObject({
      path: "src/auth.ts",
      lineStart: 12,
      sourceLabel: expect.stringMatching(/evidence span/),
    });
    expect(brief.check?.nextCommands[0]?.accept).toMatch(/^marrow accept q_/);
    expect(brief.check?.nextCommands[0]?.dismiss).toMatch(/^marrow dismiss q_/);
    expect(brief.askHumanFirst.questions.some((q) => /^drift:/i.test(q.title))).toBe(true);
  });

  it("maintainTruth returns goals, proposed goals, contested facts, gaps, pending catches, connector health and next actions", async () => {
    const { decision } = await seedPasswordTruth();
    const text = "Product goal: make onboarding self serve";
    const ev = await store.insertEvidence({ text, source: "standups/goals.md" });
    await store.insertGoal({
      title: "Make onboarding self serve",
      goalType: "product",
      status: "decided",
      confidence: human,
      provenance: [{ evidenceId: ev.id, start: 0, end: text.length }],
    });
    await store.insertGoal({
      title: "Offer passkeys someday",
      goalType: "user",
      status: "open",
      confidence: modelConf,
      provenance: [{ evidenceId: ev.id, start: 0, end: 12 }],
    });
    await store.insertDecision({
      title: "Password login might return",
      rationale: "",
      constraint: false,
      status: "contested",
      confidence: modelConf,
      provenance: [{ evidenceId: ev.id, start: 0, end: 12 }],
    });
    await store.insertQuestion({
      prompt: "goal gap: which feature serves the onboarding goal?",
      status: "open",
      confidence: modelConf,
      provenance: [{ evidenceId: ev.id, start: 0, end: 12 }],
    });
    const { created } = await core.driftScan(".", {
      hunks: [hunk("src/auth.ts", "const passwordHash = hash(password);")],
      semantic: false,
    });
    expect(created.length).toBeGreaterThan(0);
    await core.upsertConnector({
      name: "slack",
      kind: "slack",
      enabled: true,
      settings: { channelIds: ["C1"] },
      secret: "xoxb-test",
    });

    const brief = await core.maintainTruth();
    expect(brief.sourceOfTruth.decidedGoals.some((g) => g.title.includes("self serve"))).toBe(true);
    expect(brief.sourceOfTruth.decidedGoals.every((g) => g.status === "decided")).toBe(true);
    expect(brief.openProposedGoals.some((g) => g.title.includes("passkeys"))).toBe(true);
    expect(brief.contestedFacts.some((f) => f.title.includes("Password login"))).toBe(true);
    expect(brief.gapQuestions.some((q) => /goal gap/i.test(q.title))).toBe(true);
    expect(brief.pendingCatches.some((c) => c.decisionTitle === decision.title)).toBe(true);
    expect(brief.connectorHealth.some((c) => c.name === "slack" && c.status === "never")).toBe(
      true,
    );
    expect(brief.nextActions.length).toBeGreaterThan(0);
    expect(brief.sourceOfTruth.decidedGoals[0]?.provenance[0]?.source).toBeDefined();
  });

  it("recordCatchResolution records the agent's reaction and NEVER touches the question", async () => {
    await seedPasswordTruth();
    const { created } = await core.driftScan(".", {
      hunks: [hunk("src/auth.ts", "const passwordHash = hash(password);", 12)],
      semantic: false,
    });
    const catchQuestion = created[0];
    if (!catchQuestion) throw new Error("expected a drift catch");

    const record = await core.recordCatchResolution(
      catchQuestion.id,
      "reverted the password change",
      "acted_on",
    );
    expect(record.question.status).toBe("open");
    expect(record.next).toContain("marrow accept");
    // the question is still open in the store: recording is not deciding.
    expect((await store.getQuestion(catchQuestion.id))?.status).toBe("open");

    // the agent's reaction clears the pending list (someone reacted)...
    const brief = await core.maintainTruth();
    expect(brief.pendingCatches.every((c) => c.id !== catchQuestion.id)).toBe(true);

    // ...but never pollutes the human-labeled metrics.
    const metrics = await store.getCatchMetrics({});
    expect(metrics.actedOn).toBe(0);

    // the human can still close it through the CLI path, which promotes.
    const closed = await core.acceptCatch(catchQuestion.id, "confirmed the revert");
    expect(closed.status).toBe("decided");
    const after = await store.getCatchMetrics({});
    expect(after.actedOn).toBe(1);
  });

  it("recordCatchResolution guards like accept/dismiss: drift-only, open-only, decided-related", async () => {
    await expect(core.recordCatchResolution("q_missing", "text", "acted_on")).rejects.toThrow(
      /not found/,
    );
    const ev = await store.insertEvidence({ text: "plain question", source: "room/q.md" });
    const plain = await store.insertQuestion({
      prompt: "not a drift catch",
      status: "open",
      confidence: modelConf,
      provenance: [{ evidenceId: ev.id, start: 0, end: 5 }],
    });
    await expect(core.recordCatchResolution(plain.id, "text", "dismissed")).rejects.toThrow(
      /not a drift catch/,
    );
  });

  it("maintainTruth surfaces the undistilled evidence backlog with a drain action", async () => {
    // a session-end hook write: evidence appended, never distilled.
    await store.insertEvidence({
      text: "raw transcript from a finished session",
      source: "session/2026-07-11T10:00:00Z",
    });
    const brief = await core.maintainTruth();
    expect(brief.undistilledBacklog.count).toBeGreaterThanOrEqual(1);
    expect(brief.undistilledBacklog.sample.length).toBeGreaterThanOrEqual(1);
    expect(brief.undistilledBacklog.oldestCreatedAt).toBeDefined();
    expect(brief.nextActions.join(" ")).toContain("marrow distill --pending");
  });
});

// the goal kind flows through the same propose -> human-promote machinery as a
// decision: the agent proposes goals open/model, only a human (answer or
// authorGoal) makes one decided.
describe("goals through the loop", () => {
  it("proposeNode creates a goal as open with model confidence", async () => {
    const ev = await store.insertEvidence({ text: "ship passwordless onboarding", source: "x" });
    const goal = await core.proposeNode({
      kind: "goal",
      title: "Ship passwordless onboarding",
      goalType: "product",
      provenance: [{ evidenceId: ev.id, start: 0, end: 4 }],
    });
    expect(goal.kind).toBe("goal");
    expect(goal.status).toBe("open");
    expect(goal.confidence.source).toBe("model");
  });

  it("a human answer promotes a goal to decided/human", async () => {
    const ev = await store.insertEvidence({
      text: "let users self-serve password reset",
      source: "x",
    });
    const goal = await store.insertGoal({
      title: "Users can self-serve password reset",
      goalType: "user",
      status: "open",
      confidence: modelConf,
      provenance: [{ evidenceId: ev.id, start: 0, end: 10 }],
    });
    const q = await store.insertQuestion({
      prompt: "is this goal committed?",
      relatesTo: [goal.id],
      status: "open",
      confidence: modelConf,
      provenance: [{ evidenceId: ev.id, start: 0, end: 10 }],
    });
    await core.answer(q.id, "yes, this is a committed goal");
    const updated = await core.getNode(goal.id);
    expect(updated?.status).toBe("decided");
    expect(updated?.confidence.source).toBe("human");
  });

  it("answering a goal conflict supersedes the losing goal", async () => {
    const ev = await store.insertEvidence({
      text: "two competing retention goals",
      source: "x",
    });
    const prov = [{ evidenceId: ev.id, start: 0, end: 3 }];
    const a = await store.insertGoal({
      title: "maximize weekly retention",
      goalType: "product",
      status: "open",
      confidence: modelConf,
      provenance: prov,
    });
    const b = await store.insertGoal({
      title: "maximize daily retention",
      goalType: "product",
      status: "open",
      confidence: modelConf,
      provenance: prov,
    });
    const q = await store.insertQuestion({
      prompt: "which retention goal holds?",
      relatesTo: [a.id, b.id],
      status: "open",
      confidence: modelConf,
      provenance: prov,
    });
    await core.answer(q.id, "weekly is the goal", { decide: a.id });
    expect((await core.getNode(a.id))?.status).toBe("decided");
    expect((await core.getNode(b.id))?.status).toBe("superseded");
  });

  it("authorGoal creates a decided/human goal rooted in freshly-captured evidence", async () => {
    const goal = await core.authorGoal({
      title: "Cut onboarding to under five minutes",
      description: "new teams reach value fast",
      goalType: "product",
    });
    expect(goal.kind).toBe("goal");
    expect(goal.status).toBe("decided");
    expect(goal.confidence.source).toBe("human");
    expect(goal.confidence.value).toBe(1);
    // the team's own statement is the evidence: provenance points at a fresh
    // evidence row whose text contains the authored title (append-only, INSERT).
    const span = goal.provenance[0];
    if (!span) throw new Error("expected provenance");
    const evidence = await core.getEvidence(span.evidenceId);
    expect(evidence?.text).toContain("Cut onboarding to under five minutes");
    expect(evidence?.source).toBe("goals/console");
  });
});

describe("questionImpact ranks structurally, not on prompt wording", () => {
  it("a conflict that relates two decisions ranks high even with no keyword", () => {
    expect(
      questionImpact({ prompt: "which approach do we keep?", relatesTo: ["dec_a", "dec_b"] }),
    ).toBe(3);
  });
  it("still catches a conflict phrased with the keyword", () => {
    expect(questionImpact({ prompt: "possible conflict here", relatesTo: ["dec_a"] })).toBe(3);
  });
  it("a drift question outranks a plain gap", () => {
    const drift = questionImpact({
      prompt: "drift: the code references passwords",
      relatesTo: ["dec_a"],
    });
    const gap = questionImpact({
      prompt: 'mentions "x" but never decided anything',
      relatesTo: ["ent_a"],
    });
    expect(drift).toBeGreaterThan(gap);
  });
});
