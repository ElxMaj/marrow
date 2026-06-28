import { describe, expect, it } from "vitest";

import { loadBenchmarkCorpus } from "./cli.js";

// The `marrow benchmark` corpus has to resolve relative to the package (so it
// works once published with files:["dist","benchmark"]), not relative to a
// repo-root that won't exist in an installed package. This is a pure file-read,
// so it needs no database — unlike the rest of the CLI tests.
describe("loadBenchmarkCorpus", () => {
  it("resolves and parses the bundled benchmark corpus", () => {
    const corpus = loadBenchmarkCorpus();
    expect(Array.isArray(corpus)).toBe(true);
    expect(corpus.length).toBeGreaterThan(0);
  });

  it("returns seed docs with the fields the benchmark needs", () => {
    const doc = loadBenchmarkCorpus()[0];
    expect(doc).toBeDefined();
    expect(typeof doc?.text).toBe("string");
    expect((doc?.text ?? "").length).toBeGreaterThan(0);
  });
});
