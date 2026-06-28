import { describe, expect, it } from "vitest";

import { goalView } from "./components";
import type { GoalView } from "./ui";

// goalView mirrors decisionView: it reduces a Goal to the NodeView the shared
// card + trace panel render, carrying the status, confidence and provenance
// untouched so decided-vs-open and "trace to source" still hold for goals.
describe("goalView", () => {
  const base: GoalView = {
    id: "goal_aabbccdd",
    kind: "goal",
    title: "users can restore deleted records for 30 days",
    description: "soft delete with a visible recovery window",
    goalType: "user",
    status: "decided",
    confidence: { value: 1, source: "human" },
    provenance: [{ evidenceId: "ev_1", start: 0, end: 12 }],
  };

  it("maps a Goal to a goal-kind NodeView, carrying status, confidence, provenance", () => {
    const view = goalView(base);
    expect(view.kind).toBe("goal");
    expect(view.id).toBe(base.id);
    expect(view.title).toBe(base.title);
    expect(view.sub).toBe(base.description);
    expect(view.status).toBe("decided");
    expect(view.confidence).toEqual({ value: 1, source: "human" });
    expect(view.provenance).toEqual(base.provenance);
  });

  it("omits the sub line when the goal has no description", () => {
    const view = goalView({
      id: "goal_eeff0011",
      kind: "goal",
      title: "reach SOC2 compliance",
      goalType: "product",
      status: "open",
      confidence: { value: 0.5, source: "model" },
      provenance: [{ evidenceId: "ev_2", start: 0, end: 5 }],
    });
    expect(view.sub).toBeUndefined();
  });
});
