import { describe, expect, it } from "vitest";

import {
  OVERVIEW_ITEMS_THIS_WEEK_COPY,
  overviewRequestUrls,
  summarizeOverview,
} from "./views/Overview";
import type { ConnectorView, RunView, SandboxState } from "./ui";

const confidence = { value: 0.8, source: "model" as const };
const provenance = [{ evidenceId: "ev_overview", start: 0, end: 8 }];

function state(): SandboxState {
  return {
    decisions: [
      {
        id: "dec_decided",
        kind: "decision",
        title: "Use magic links",
        rationale: "No passwords",
        constraint: true,
        status: "decided",
        confidence,
        provenance,
      },
      {
        id: "dec_open",
        kind: "decision",
        title: "Shift timeout",
        rationale: "Needs human answer",
        constraint: false,
        status: "open",
        confidence,
        provenance,
      },
    ],
    entities: [
      {
        id: "ent_auth",
        kind: "entity",
        name: "Authentication",
        status: "decided",
        confidence,
        provenance,
      },
    ],
    questions: [
      {
        id: "q_timeout",
        kind: "question",
        prompt: "How long should shift sessions last?",
        status: "open",
        confidence,
        provenance,
      },
      {
        id: "q_gap",
        kind: "question",
        prompt: "Who owns the kiosk flow?",
        status: "open",
        confidence,
        provenance,
      },
    ],
  };
}

function connector(over: Partial<ConnectorView>): ConnectorView {
  return {
    name: "slack",
    kind: "slack",
    enabled: true,
    settings: {},
    hasSecret: true,
    lastStatus: "ok",
    totalItems: 0,
    updatedAt: "2026-06-20T00:00:00Z",
    ...over,
  };
}

function run(over: Partial<RunView>): RunView {
  return {
    id: "run_sync",
    kind: "connector_sync",
    status: "ok",
    latencyMs: 10,
    createdAt: "2026-06-20T00:00:00Z",
    ...over,
  };
}

describe("overviewRequestUrls", () => {
  it("fetches the dashboard data set for the last seven days", () => {
    const urls = overviewRequestUrls(Date.parse("2026-06-27T12:00:00Z"));
    expect(urls.sinceMs).toBe(Date.parse("2026-06-20T12:00:00Z"));
    expect(urls.metrics).toBe("/api/metrics?since=2026-06-20T12%3A00%3A00.000Z");
    expect(urls.connectors).toBe("/api/connectors");
    expect(urls.recentRuns).toBe("/api/runs?limit=8");
    expect(urls.syncRuns).toBe("/api/runs?kind=connector_sync&limit=200");
  });
});

describe("summarizeOverview", () => {
  it("counts decided facts, open questions, entities, connector health and weekly items", () => {
    const summary = summarizeOverview({
      state: state(),
      connectors: [
        connector({ name: "slack", enabled: true, lastStatus: "ok", totalItems: 4 }),
        connector({ name: "zoom", kind: "zoom", enabled: false, lastStatus: "error" }),
        connector({ name: "linear", kind: "linear", enabled: true, lastStatus: "never" }),
      ],
      syncRuns: [
        run({
          createdAt: "2026-06-26T00:00:00Z",
          metadata: { itemsIngested: 3 },
        }),
        run({
          createdAt: "2026-06-19T00:00:00Z",
          metadata: { itemsIngested: 7 },
        }),
        run({
          status: "error",
          createdAt: "2026-06-26T00:00:00Z",
          metadata: { itemsIngested: 11 },
        }),
      ],
      sinceMs: Date.parse("2026-06-20T12:00:00Z"),
    });

    expect(summary).toEqual({
      decided: 1,
      openQuestions: 2,
      entities: 1,
      flowingConnectors: 2,
      erroringConnectors: 1,
      itemsThisWeek: 3,
    });
  });
});

describe("overview items stat copy", () => {
  it("labels connector throughput as items, not drift catches", () => {
    expect(OVERVIEW_ITEMS_THIS_WEEK_COPY).toEqual({
      label: "Items this week",
      foot: "Brought in by your connectors",
    });
  });
});
