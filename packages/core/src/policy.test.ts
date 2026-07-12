import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_POLICY,
  filterExtraction,
  loadPolicy,
  matchesNoDistillSource,
  policyPromptClause,
} from "./policy.js";

const extraction = (over: Record<string, unknown> = {}) => ({
  entities: [],
  decisions: [],
  goals: [],
  questions: [],
  ...over,
});

describe("extraction policy", () => {
  it("falls back to conservative defaults when no policy file exists", () => {
    const policy = loadPolicy(mkdtempSync(join(tmpdir(), "marrow-policy-")));
    expect(policy).toEqual(DEFAULT_POLICY);
    expect(policy.denyPatterns.length).toBeGreaterThan(0);
  });

  it("merges a custom policy file over the defaults and never throws on junk", () => {
    const dir = mkdtempSync(join(tmpdir(), "marrow-policy-"));
    mkdirSync(join(dir, ".marrow"));
    writeFileSync(
      join(dir, ".marrow", "policy.json"),
      JSON.stringify({ noDistillSources: ["scratch/*"], denyPatterns: ["\\bcustomer pii\\b"] }),
    );
    const policy = loadPolicy(dir);
    expect(policy.noDistillSources).toEqual(["scratch/*"]);
    expect(policy.denyPatterns).toEqual(["\\bcustomer pii\\b"]);
    expect(policy.neverDistill).toEqual(DEFAULT_POLICY.neverDistill);

    writeFileSync(join(dir, ".marrow", "policy.json"), "not json at all");
    expect(loadPolicy(dir)).toEqual(DEFAULT_POLICY);
  });

  it("matches no-distill sources with * wildcards, case-insensitive", () => {
    const policy = { ...DEFAULT_POLICY, noDistillSources: ["scratch/*", "bots/feed"] };
    expect(matchesNoDistillSource(policy, "scratch/ideas.md")).toBe(true);
    expect(matchesNoDistillSource(policy, "Bots/Feed")).toBe(true);
    expect(matchesNoDistillSource(policy, "interviews/gdynia.md")).toBe(false);
  });

  it("the deterministic filter drops calendar chatter and keeps real decisions", () => {
    const { extraction: kept, dropped } = filterExtraction(
      extraction({
        decisions: [
          { title: "Standup moved to Thursday at 10am", quote: "standup moved to Thursday" },
          { title: "Billing uses stripe only", quote: "stripe only" },
          { title: "Ship the meeting scheduler feature", quote: "the scheduler ships in Q3" },
        ],
      }) as never,
      DEFAULT_POLICY,
    );
    expect(dropped).toBe(1);
    expect(kept.decisions.map((d) => d.title)).toEqual([
      "Billing uses stripe only",
      "Ship the meeting scheduler feature",
    ]);
  });

  it("a malformed deny pattern is skipped, never fatal", () => {
    const policy = { ...DEFAULT_POLICY, denyPatterns: ["([unclosed", "\\bdroppable\\b"] };
    const { extraction: kept, dropped } = filterExtraction(
      extraction({
        questions: [{ prompt: "is this droppable smalltalk?", quote: "droppable" }],
      }) as never,
      policy,
    );
    expect(dropped).toBe(1);
    expect(kept.questions).toHaveLength(0);
  });

  it("the prompt clause names the categories, or stays silent", () => {
    expect(policyPromptClause(DEFAULT_POLICY)).toContain("transient scheduling details");
    expect(policyPromptClause({ ...DEFAULT_POLICY, neverDistill: [] })).toBe("");
  });
});
