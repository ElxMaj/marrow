import { describe, expect, it } from "vitest";

import {
  buildSemanticDriftPrompt,
  parseSemanticDriftResult,
  semanticDriftCheck,
} from "./semantic-drift.js";
import { type ModelProvider } from "./providers/types.js";

const hunk = (path: string, newLines: string, lineStart = 1) => ({
  path,
  lineStart,
  lineEnd: lineStart + newLines.split("\n").length - 1,
  oldLines: "",
  newLines,
  hunkHeader: "@@ -0,0 +1,1 @@",
});

const decision = {
  id: "dec_1",
  kind: "decision" as const,
  title: "no passwords, magic links only",
  rationale: "security decision from standup",
  constraint: true,
  status: "decided" as const,
  confidence: { value: 1, source: "human" as const },
  provenance: [{ evidenceId: "ev_1", start: 0, end: 10 }],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("semantic drift prompt", () => {
  it("includes the decision title and hunk path", () => {
    const prompt = buildSemanticDriftPrompt(
      [decision],
      [hunk("src/auth.ts", "const passwordHash = hash(password);")],
    );
    expect(prompt).toContain("no passwords, magic links only");
    expect(prompt).toContain("src/auth.ts");
    expect(prompt).toContain("const passwordHash");
  });
});

describe("semantic drift result parser", () => {
  it("returns candidates above the confidence threshold", () => {
    const raw = JSON.stringify({
      candidates: [
        { decisionId: "dec_1", hunkIndex: 0, confidence: 0.9, reason: "adds password hashing" },
        { decisionId: "dec_1", hunkIndex: 0, confidence: 0.5, reason: "too low" },
      ],
    });
    const result = parseSemanticDriftResult(raw);
    expect(result).toHaveLength(1);
    expect(result[0]?.confidence).toBe(0.9);
  });

  it("ignores malformed responses", () => {
    expect(parseSemanticDriftResult("not json")).toHaveLength(0);
    expect(parseSemanticDriftResult("{}")).toHaveLength(0);
    expect(parseSemanticDriftResult('{"candidates": "nope"}')).toHaveLength(0);
  });

  it("strips markdown code fences", () => {
    const raw = '```json\n{"candidates":[]}\n```';
    expect(parseSemanticDriftResult(raw)).toHaveLength(0);
  });
});

describe("semantic drift check", () => {
  it("returns empty array when no hunks or decisions are given", async () => {
    const model: ModelProvider = {
      model: "scripted",
      complete: () => Promise.resolve('{"candidates":[]}'),
    };
    expect(await semanticDriftCheck(model, [], [])).toHaveLength(0);
    expect(await semanticDriftCheck(model, [decision], [])).toHaveLength(0);
  });

  it("calls the model and parses the result", async () => {
    let called = false;
    const model: ModelProvider = {
      model: "scripted",
      complete: async () => {
        called = true;
        return JSON.stringify({
          candidates: [{ decisionId: "dec_1", hunkIndex: 0, confidence: 0.85, reason: "password" }],
        });
      },
    };
    const result = await semanticDriftCheck(model, [decision], [hunk("src/auth.ts", "password")]);
    expect(called).toBe(true);
    expect(result).toHaveLength(1);
  });
});
