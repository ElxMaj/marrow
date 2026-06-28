import { describe, expect, it } from "vitest";

import {
  ConfidenceSchema,
  DecisionSchema,
  EntitySchema,
  EvidenceSchema,
  GoalSchema,
  QuestionSchema,
  RunKindMetricsSchema,
  RunKindSchema,
  RunMetricsSchema,
  RunStatusSchema,
  StatusSchema,
  parseDecision,
  parseEntity,
  parseEvidence,
  parseGoal,
  parseNode,
  parseQuestion,
  type Node,
} from "./spine.js";

const now = () => new Date().toISOString();
const span = [{ evidenceId: "ev_1", start: 0, end: 5 }];

const evidenceInput = () => ({
  id: "ev_1",
  kind: "evidence",
  text: "we decided magic links",
  source: "interviews/pfc-gdynia.md",
  createdAt: now(),
});

const entityInput = () => ({
  id: "ent_1",
  kind: "entity",
  name: "magic link auth",
  status: "open",
  confidence: { value: 0.6, source: "model" },
  provenance: span,
  createdAt: now(),
  updatedAt: now(),
});

const decisionInput = () => ({
  id: "dec_1",
  kind: "decision",
  title: "Auth uses magic links, no shared passwords",
  rationale: "desk staff share one terminal",
  constraint: false,
  status: "decided",
  confidence: { value: 1, source: "human" },
  provenance: span,
  createdAt: now(),
  updatedAt: now(),
});

const questionInput = () => ({
  id: "q_1",
  kind: "question",
  prompt: "do desk staff need fast re-auth?",
  status: "open",
  confidence: { value: 0.5, source: "model" },
  provenance: span,
  createdAt: now(),
  updatedAt: now(),
});

const goalInput = () => ({
  id: "goal_1",
  kind: "goal",
  title: "Desk staff can re-auth in under five seconds",
  goalType: "user",
  status: "decided",
  confidence: { value: 1, source: "human" },
  provenance: span,
  createdAt: now(),
  updatedAt: now(),
});

describe("spine", () => {
  it("evidence is the root of provenance and has no status", () => {
    const ev = EvidenceSchema.parse({
      id: "ev_1",
      kind: "evidence",
      text: "we share one login at the desk, the password ends up on a post-it",
      source: "interviews/pfc-gdynia.md",
      createdAt: now(),
    });
    expect(ev.kind).toBe("evidence");
    // @ts-expect-error evidence carries no status
    expect(ev.status).toBeUndefined();
  });

  it("a decision links back to an exact evidence span", () => {
    const d = DecisionSchema.parse({
      id: "dec_1",
      kind: "decision",
      title: "Auth uses magic links, no shared passwords",
      rationale: "desk staff share one terminal and wrote passwords on sticky notes",
      constraint: false,
      status: "decided",
      confidence: { value: 0.9, source: "human" },
      provenance: [{ evidenceId: "ev_1", start: 0, end: 64 }],
      createdAt: now(),
      updatedAt: now(),
    });
    const [span] = d.provenance;
    if (!span) throw new Error("expected a provenance span");
    expect(span.evidenceId).toBe("ev_1");
    expect(span.end).toBeGreaterThanOrEqual(span.start);
  });

  it("resolves an entity with its name and provenance", () => {
    const e = EntitySchema.parse({
      id: "ent_1",
      kind: "entity",
      name: "magic link auth",
      status: "open",
      confidence: { value: 0.6, source: "model" },
      provenance: [{ evidenceId: "ev_1", start: 0, end: 14 }],
      createdAt: now(),
      updatedAt: now(),
    });
    expect(e.name).toBe("magic link auth");
    expect(e.provenance).toHaveLength(1);
  });

  it("accepts the five allowed fact statuses", () => {
    for (const status of StatusSchema.options) {
      const parsed = DecisionSchema.parse({ ...decisionInput(), status });
      expect(parsed.status).toBe(status);
    }
  });

  it("rejects a status outside the five allowed", () => {
    expect(() =>
      DecisionSchema.parse({
        id: "dec_2",
        kind: "decision",
        title: "x",
        rationale: "y",
        constraint: false,
        status: "maybe",
        confidence: { value: 0.5, source: "model" },
        provenance: [{ evidenceId: "ev_1", start: 0, end: 1 }],
        createdAt: now(),
        updatedAt: now(),
      }),
    ).toThrow();
  });

  it("rejects confidence outside 0..1", () => {
    expect(() =>
      QuestionSchema.parse({
        id: "q_1",
        kind: "question",
        prompt: "do desk staff need fast re-auth?",
        status: "open",
        confidence: { value: 1.4, source: "model" },
        provenance: [{ evidenceId: "ev_1", start: 0, end: 1 }],
        createdAt: now(),
        updatedAt: now(),
      }),
    ).toThrow();
  });

  it("keeps confidence boundary errors explicit", () => {
    expect(ConfidenceSchema.parse({ value: 0, source: "model" }).value).toBe(0);
    expect(ConfidenceSchema.parse({ value: 1, source: "human" }).value).toBe(1);
    expect(() => ConfidenceSchema.parse({ value: -0.1, source: "model" })).toThrow(/below 0/);
    expect(() => ConfidenceSchema.parse({ value: 1.1, source: "model" })).toThrow(/above 1/);
  });

  it("rejects a provenance span whose end precedes its start", () => {
    expect(() =>
      QuestionSchema.parse({
        id: "q_bad",
        kind: "question",
        prompt: "bad span",
        status: "open",
        confidence: { value: 0.3, source: "model" },
        provenance: [{ evidenceId: "ev_1", start: 10, end: 2 }],
        createdAt: now(),
        updatedAt: now(),
      }),
    ).toThrow();
  });

  it("requires at least one provenance span on a distilled node", () => {
    expect(() =>
      QuestionSchema.parse({
        id: "q_noprov",
        kind: "question",
        prompt: "no provenance",
        status: "open",
        confidence: { value: 0.3, source: "model" },
        provenance: [],
        createdAt: now(),
        updatedAt: now(),
      }),
    ).toThrow();
  });

  it("a goal carries its type, an entity link, and a provenance span", () => {
    const g = GoalSchema.parse({
      id: "goal_1",
      kind: "goal",
      title: "Desk staff can re-auth in under five seconds",
      description: "a shared terminal means re-auth happens constantly",
      goalType: "user",
      entityId: "ent_1",
      status: "decided",
      confidence: { value: 0.9, source: "human" },
      provenance: [{ evidenceId: "ev_1", start: 0, end: 30 }],
      createdAt: now(),
      updatedAt: now(),
    });
    expect(g.goalType).toBe("user");
    expect(g.entityId).toBe("ent_1");
    expect(g.provenance).toHaveLength(1);
  });

  it("a goal links to an entity but never requires one", () => {
    const g = GoalSchema.parse({
      id: "goal_2",
      kind: "goal",
      title: "Cut onboarding to one day",
      goalType: "product",
      status: "open",
      confidence: { value: 0.5, source: "model" },
      provenance: [{ evidenceId: "ev_1", start: 0, end: 5 }],
      createdAt: now(),
      updatedAt: now(),
    });
    expect(g.entityId).toBeUndefined();
  });

  it("rejects a goalType outside product and user", () => {
    expect(() =>
      GoalSchema.parse({
        id: "goal_bad",
        kind: "goal",
        title: "x",
        goalType: "team",
        status: "open",
        confidence: { value: 0.5, source: "model" },
        provenance: [{ evidenceId: "ev_1", start: 0, end: 1 }],
        createdAt: now(),
        updatedAt: now(),
      }),
    ).toThrow();
  });

  it("a goal needs at least one provenance span, like every distilled fact", () => {
    expect(() =>
      GoalSchema.parse({
        id: "goal_noprov",
        kind: "goal",
        title: "no provenance",
        goalType: "product",
        status: "open",
        confidence: { value: 0.3, source: "model" },
        provenance: [],
        createdAt: now(),
        updatedAt: now(),
      }),
    ).toThrow();
  });

  it("parseGoal and parseNode both accept a goal and narrow on kind", () => {
    const viaHelper = parseGoal({
      id: "goal_3",
      kind: "goal",
      title: "Self-host stays one Postgres",
      goalType: "product",
      status: "decided",
      confidence: { value: 1, source: "human" },
      provenance: [{ evidenceId: "ev_1", start: 0, end: 5 }],
      createdAt: now(),
      updatedAt: now(),
    });
    expect(viaHelper.goalType).toBe("product");
    const n = parseNode(viaHelper);
    expect(n.kind).toBe("goal");
    if (n.kind === "goal") expect(n.title).toBe("Self-host stays one Postgres");
    else throw new Error("did not narrow to goal");
  });

  it("Node narrows on kind", () => {
    const n: Node = QuestionSchema.parse({
      id: "q_2",
      kind: "question",
      prompt: "open?",
      status: "open",
      confidence: { value: 0.3, source: "model" },
      provenance: [{ evidenceId: "ev_1", start: 0, end: 1 }],
      createdAt: now(),
      updatedAt: now(),
    });
    if (n.kind === "question") expect(n.prompt).toBe("open?");
    else throw new Error("did not narrow");
  });

  it("parseNode accepts a decision through the full node union", () => {
    const n = parseNode({
      id: "dec_3",
      kind: "decision",
      title: "sessions are short lived",
      rationale: "shared desk terminal",
      constraint: true,
      status: "decided",
      confidence: { value: 1, source: "human" },
      provenance: [{ evidenceId: "ev_1", start: 0, end: 5 }],
      createdAt: now(),
      updatedAt: now(),
    });
    expect(n.kind).toBe("decision");
    if (n.kind === "decision") expect(n.constraint).toBe(true);
  });

  it("parseNode rejects an unknown node kind", () => {
    expect(() =>
      parseNode({
        id: "mystery_1",
        kind: "mystery",
        status: "open",
        confidence: { value: 0.5, source: "model" },
        provenance: span,
        createdAt: now(),
        updatedAt: now(),
      }),
    ).toThrow(/Invalid discriminator value/);
  });

  it("parse helpers smoke-test each concrete node contract", () => {
    expect(parseEvidence(evidenceInput()).kind).toBe("evidence");
    expect(parseEntity(entityInput()).kind).toBe("entity");
    expect(parseDecision(decisionInput()).kind).toBe("decision");
    expect(parseQuestion(questionInput()).kind).toBe("question");
    expect(parseGoal(goalInput()).kind).toBe("goal");
  });

  it("parse helpers reject invalid input instead of returning partial objects", () => {
    expect(() => parseEvidence({ ...evidenceInput(), id: "" })).toThrow();
    expect(() => parseEntity({ ...entityInput(), name: "" })).toThrow();
    expect(() => parseDecision({ ...decisionInput(), title: "" })).toThrow();
    expect(() => parseQuestion({ ...questionInput(), prompt: "" })).toThrow();
    expect(() => parseGoal({ ...goalInput(), goalType: "team" })).toThrow();
  });

  it("accepts only known run kind and status tags", () => {
    expect(RunKindSchema.parse("drift")).toBe("drift");
    expect(RunKindSchema.parse("connector_sync")).toBe("connector_sync");
    expect(RunStatusSchema.parse("error")).toBe("error");
    expect(RunStatusSchema.parse("ok")).toBe("ok");
    expect(() => RunKindSchema.parse("compile")).toThrow();
    expect(() => RunStatusSchema.parse("pending")).toThrow();
  });

  it("parses nonnegative run metrics with per-kind aggregates", () => {
    const kindMetrics = RunKindMetricsSchema.parse({
      count: 2,
      errorCount: 1,
      costUsd: 0.15,
      avgLatencyMs: 42,
    });
    expect(kindMetrics.errorCount).toBe(1);

    const metrics = RunMetricsSchema.parse({
      count: 4,
      errorCount: 1,
      totalTokensIn: 120,
      totalTokensOut: 60,
      totalCostUsd: 0.32,
      p50LatencyMs: 30,
      p95LatencyMs: 80,
      byKind: {
        distill: kindMetrics,
        drift: { count: 2, errorCount: 0, costUsd: 0, avgLatencyMs: 20 },
      },
    });
    expect(metrics.byKind.distill?.count).toBe(2);
    expect(() => RunKindMetricsSchema.parse({ ...kindMetrics, count: -1 })).toThrow();
    expect(() => RunMetricsSchema.parse({ ...metrics, totalTokensIn: -1 })).toThrow();
  });
});
