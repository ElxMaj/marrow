import { describe, expect, it } from "vitest";

import {
  catchActionsDisabled,
  catchActionPrompt,
  catchDismissRateTone,
  catchMetricPercent,
  catchMetricsTones,
  catchPrecisionTone,
  catchReceiptDirty,
  catchesForFilter,
  catchesShowActionColumn,
  type CatchFilter,
} from "./views/Catches";
import type { CatchView } from "./ui";

function catchView(over: Partial<CatchView>): CatchView {
  return {
    id: "catch_open",
    status: "open",
    path: "src/auth.ts",
    lineStart: 12,
    lineEnd: 18,
    hunkText: "+ password login",
    decisionId: "dec_magic_links",
    decisionTitle: "Use magic links",
    decisionSourceLabel: "interviews/auth.md",
    verdict: "contradiction",
    confidence: 0.82,
    modelUsed: "semantic-test",
    surfacedAt: "2026-06-27T12:00:00Z",
    trigger: "manual",
    ...over,
  };
}

describe("Catches view presentation rules", () => {
  const catches = [
    catchView({ id: "catch_open", status: "open" }),
    catchView({ id: "catch_acted", status: "acted-on" }),
    catchView({ id: "catch_dismissed", status: "dismissed" }),
  ];

  it("keeps open catch actions available in the all filter", () => {
    const visible = catchesForFilter(catches, "all");
    expect(visible.map((c) => c.id)).toEqual(["catch_open", "catch_acted", "catch_dismissed"]);
    expect(catchesShowActionColumn(visible)).toBe(true);
  });

  it("hides the action column when the visible filter has no open catches", () => {
    for (const filter of ["acted-on", "dismissed"] satisfies CatchFilter[]) {
      const visible = catchesForFilter(catches, filter);
      expect(visible.every((c) => c.status === filter)).toBe(true);
      expect(catchesShowActionColumn(visible)).toBe(false);
    }
  });

  it("disables action buttons while read-only or acting on the same catch", () => {
    const open = catches[0]!;
    expect(catchActionsDisabled(open, { readOnly: true, acting: null })).toBe(true);
    expect(catchActionsDisabled(open, { readOnly: false, acting: "catch_open" })).toBe(true);
    expect(catchActionsDisabled(open, { readOnly: false, acting: "catch_acted" })).toBe(false);
    expect(catchActionsDisabled(open, { readOnly: false, acting: null })).toBe(false);
  });

  it("names inline catch action forms without relying on browser prompts", () => {
    expect(catchActionPrompt("accept")).toBe("What did you do about this drift?");
    expect(catchActionPrompt("dismiss")).toBe("Why is this noise?");
  });

  it("renders catch metric ratios as whole human percentages", () => {
    expect(catchMetricPercent(2 / 3)).toBe("67%");
    expect(catchMetricPercent(1 / 3)).toBe("33%");
    expect(catchMetricPercent(1)).toBe("100%");
    expect(catchMetricPercent(0)).toBe("0%");
  });

  it("warns on catch metric ratios using ratio thresholds", () => {
    expect(catchPrecisionTone(0.79)).toBe("warn");
    expect(catchPrecisionTone(0.8)).toBeUndefined();
    expect(catchDismissRateTone(0.21)).toBe("warn");
    expect(catchDismissRateTone(0.2)).toBeUndefined();
  });

  it("a receipt draft is dirty only when it holds real text", () => {
    // the navigation guard fires on a dirty receipt: whitespace or an
    // untouched form is safe to abandon, typed content is not.
    expect(catchReceiptDirty(null)).toBe(false);
    expect(catchReceiptDirty({ text: "" })).toBe(false);
    expect(catchReceiptDirty({ text: "   " })).toBe(false);
    expect(catchReceiptDirty({ text: "reverted the card wall" })).toBe(true);
  });

  it("stays neutral until a catch has actually been resolved", () => {
    // With nothing acted on or dismissed, precision 0% is no-data, not failure:
    // a red 0% before the first resolution would read as the product failing.
    expect(
      catchMetricsTones({ surfaced: 1, actedOn: 0, dismissed: 0, precision: 0, dismissRate: 0 }),
    ).toEqual({});
    expect(catchMetricsTones(null)).toEqual({});
    // Once one catch is resolved the ratio thresholds apply as before.
    expect(
      catchMetricsTones({ surfaced: 2, actedOn: 0, dismissed: 1, precision: 0, dismissRate: 0.5 }),
    ).toEqual({ precision: "warn", dismissRate: "warn" });
    expect(
      catchMetricsTones({ surfaced: 1, actedOn: 1, dismissed: 0, precision: 1, dismissRate: 0 }),
    ).toEqual({});
  });
});
