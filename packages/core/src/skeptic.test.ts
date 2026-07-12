import { describe, expect, it } from "vitest";

import { skepticReasons, verdictFor } from "./skeptic.js";

const span = (evidenceId: string, start: number, end: number) => ({ evidenceId, start, end });

describe("skeptic reasons", () => {
  it("flags a single-source proposal", () => {
    const reasons = skepticReasons(
      { confidence: { value: 0.8 }, provenance: [span("ev_a", 0, 40)] },
      false,
    );
    expect(reasons).toContain("single_source");
    expect(reasons).not.toContain("weak_provenance");
    expect(reasons).not.toContain("contradicts_decided");
  });

  it("does not flag single_source when two distinct evidence rows back it", () => {
    const reasons = skepticReasons(
      { confidence: { value: 0.8 }, provenance: [span("ev_a", 0, 40), span("ev_b", 0, 40)] },
      false,
    );
    expect(reasons).not.toContain("single_source");
  });

  it("flags weak provenance for a tiny span or low confidence", () => {
    expect(
      skepticReasons({ confidence: { value: 0.9 }, provenance: [span("ev_a", 0, 5)] }, false),
    ).toContain("weak_provenance");
    expect(
      skepticReasons(
        { confidence: { value: 0.3 }, provenance: [span("ev_a", 0, 40), span("ev_b", 0, 40)] },
        false,
      ),
    ).toContain("weak_provenance");
  });

  it("flags a contradiction when the caller found one", () => {
    const reasons = skepticReasons(
      { confidence: { value: 0.9 }, provenance: [span("ev_a", 0, 40), span("ev_b", 0, 40)] },
      true,
    );
    expect(reasons).toEqual(["contradicts_decided"]);
  });

  it("flags instruction smells when the caller detected one in a cited span", () => {
    const reasons = skepticReasons(
      { confidence: { value: 0.9 }, provenance: [span("ev_a", 0, 40), span("ev_b", 0, 40)] },
      false,
      true,
    );
    expect(reasons).toEqual(["instruction_smell"]);
  });

  it("verdictFor: no reasons survives, any reason flags", () => {
    expect(verdictFor([])).toBe("survived");
    expect(verdictFor(["single_source"])).toBe("flagged");
    expect(verdictFor(["single_source", "weak_provenance"])).toBe("flagged");
    expect(verdictFor(["instruction_smell"])).toBe("flagged");
  });
});
