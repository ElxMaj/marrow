import { describe, expect, it } from "vitest";

import { escapeHtml, relativeTime, renderTruthHtml } from "./brief-html.js";
import type { BriefNode, TruthMaintenanceBrief } from "./marrow.js";

function node(overrides: Partial<BriefNode> = {}): BriefNode {
  return {
    id: "dec_1",
    kind: "decision",
    title: "Free trial, no card upfront",
    status: "decided",
    confidence: { value: 1, source: "human" },
    provenance: [
      {
        evidenceId: "ev_1",
        start: 0,
        end: 20,
        source: "pricing call",
        spanText: "we agreed: free trial, no card",
        createdAt: "2026-07-10T00:00:00.000Z",
      },
    ],
    ...overrides,
  } as BriefNode;
}

function brief(overrides: Partial<TruthMaintenanceBrief> = {}): TruthMaintenanceBrief {
  return {
    sourceOfTruth: { decidedGoals: [], decidedDecisions: [node()] },
    openProposedGoals: [],
    contestedFacts: [],
    gapQuestions: [],
    pendingCatches: [],
    connectorHealth: [],
    undistilledBacklog: { count: 0, sample: [] },
    nextActions: ["Answer gap questions, especially goals without a served feature."],
    ...overrides,
  } as TruthMaintenanceBrief;
}

const OPTS = { now: Date.parse("2026-07-18T00:00:00.000Z"), generatedAt: "2026-07-18 00:00 UTC" };

describe("renderTruthHtml", () => {
  it("returns a complete self-contained HTML document with no external asset", () => {
    const html = renderTruthHtml(brief(), OPTS);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
    // self-contained: one inline style block, no external stylesheet, script, or img.
    expect(html).toContain("<style>");
    expect(html).not.toMatch(/<link\b/);
    expect(html).not.toMatch(/<script\b/);
    expect(html).not.toMatch(/<img\b/);
    expect(html).not.toMatch(/https?:\/\//); // no hotlinked host anywhere by default
  });

  it("renders decided facts with their titles and the verbatim provenance span", () => {
    const html = renderTruthHtml(brief(), OPTS);
    expect(html).toContain("Free trial, no card upfront");
    expect(html).toContain("we agreed: free trial, no card");
    expect(html).toContain("pricing call");
  });

  it("escapes HTML in a fact title so a span can never inject markup", () => {
    const html = renderTruthHtml(
      brief({
        sourceOfTruth: {
          decidedGoals: [],
          decidedDecisions: [node({ title: "<script>x</script>" })],
        },
      }),
      OPTS,
    );
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });

  it("keeps gold for action only: status chips use status hues, never the gold token", () => {
    const html = renderTruthHtml(brief(), OPTS);
    // the one action block is gold...
    expect(html).toContain("What needs you");
    expect(html).toMatch(/border-left:2px solid var\(--gold\)/);
    // ...and a decided chip is sage, an open chip amber, never gold.
    expect(html).toContain("color:var(--decided)");
    const chipHues = html.match(/class="chip" style="color:var\((--[a-z]+)\)"/g) ?? [];
    expect(chipHues.length).toBeGreaterThan(0);
    expect(chipHues.some((c) => c.includes("--gold"))).toBe(false);
  });

  it("flags a stale decided fact and lists the next actions", () => {
    const html = renderTruthHtml(
      brief({ sourceOfTruth: { decidedGoals: [], decidedDecisions: [node({ stale: true })] } }),
      OPTS,
    );
    expect(html).toContain("stale, reverify");
    expect(html).toContain("Answer gap questions");
  });

  it("shows a settled message when nothing is waiting", () => {
    const html = renderTruthHtml(brief({ nextActions: [] }), OPTS);
    expect(html).toContain("The room is settled.");
  });

  it("carries the light-theme override so the artifact adapts to the reader", () => {
    const html = renderTruthHtml(brief(), OPTS);
    expect(html).toContain("prefers-color-scheme: light");
    expect(html).toContain('name="color-scheme" content="dark light"');
  });

  it("renders the console link as the one action when a url is given, escaping it", () => {
    const html = renderTruthHtml(brief(), {
      ...OPTS,
      consoleUrl: "https://console.example.com/?a=1&b=2",
    });
    expect(html).toContain('class="cta"');
    expect(html).toContain("https://console.example.com/?a=1&amp;b=2");
  });

  it("is deterministic for the same brief and options", () => {
    expect(renderTruthHtml(brief(), OPTS)).toBe(renderTruthHtml(brief(), OPTS));
  });

  it("counts decided facts and waiting items in the masthead stamp", () => {
    const html = renderTruthHtml(
      brief({
        openProposedGoals: [
          node({ id: "g_1", kind: "goal", status: "open", title: "A proposed goal" }),
        ],
      }),
      OPTS,
    );
    expect(html).toMatch(/<b>1<\/b> decided · 1 waiting on you/);
  });
});

describe("escapeHtml", () => {
  it("escapes the five markup-significant characters", () => {
    expect(escapeHtml(`<a href="x" data='y'>&`)).toBe(
      "&lt;a href=&quot;x&quot; data=&#39;y&#39;&gt;&amp;",
    );
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-07-18T00:00:00.000Z");
  it("buckets recent to old spans", () => {
    expect(relativeTime("2026-07-18T00:00:00.000Z", now)).toBe("just now");
    expect(relativeTime("2026-07-17T22:00:00.000Z", now)).toBe("2h ago");
    expect(relativeTime("2026-07-10T00:00:00.000Z", now)).toBe("8d ago");
    expect(relativeTime("2026-05-01T00:00:00.000Z", now)).toBe("3mo ago");
  });
  it("returns the raw value for an unparseable timestamp", () => {
    expect(relativeTime("not-a-date", now)).toBe("not-a-date");
  });
});
