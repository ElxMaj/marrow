import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Marrow } from "@marrowhq/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { watchFolder } from "./watch.js";

// A minimal fake of the core surface the watcher uses. The watcher must ask the
// store whether a source already has evidence and skip it on the startup sweep,
// so a restart does not re-ingest the whole folder (F-CLI-014).
function fakeCore(known: Set<string>) {
  return {
    canDistill: false,
    hasEvidenceSource: vi.fn((source: string) => Promise.resolve(known.has(source))),
    ingest: vi.fn((input: { text: string; source: string }) => {
      known.add(input.source);
      return Promise.resolve("ev_1");
    }),
    ingestAndDistill: vi.fn(() => Promise.resolve("ev_1")),
    ingestAudio: vi.fn(() => Promise.resolve("ev_1")),
    ingestImage: vi.fn(() => Promise.resolve("ev_1")),
    distill: vi.fn(() => Promise.resolve(undefined)),
    linkAndMerge: vi.fn(() => Promise.resolve(undefined)),
  };
}

describe("watchFolder startup sweep", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "marrow-watch-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("skips files whose source already has evidence (no re-ingest on restart)", async () => {
    const file = join(dir, "notes.md");
    writeFileSync(file, "we decided soft delete");
    const core = fakeCore(new Set([file])); // already ingested in a prior run
    const watcher = await watchFolder({
      folder: dir,
      core: core as unknown as Marrow,
      distill: false,
      debounceMs: 10,
      onEvent: () => {},
    });
    watcher.close();

    expect(core.hasEvidenceSource).toHaveBeenCalledWith(file);
    expect(core.ingest).not.toHaveBeenCalled();
  });

  it("ingests a genuinely new file on startup", async () => {
    const file = join(dir, "fresh.md");
    writeFileSync(file, "new evidence");
    const core = fakeCore(new Set());
    const watcher = await watchFolder({
      folder: dir,
      core: core as unknown as Marrow,
      distill: false,
      debounceMs: 10,
      onEvent: () => {},
    });
    watcher.close();

    expect(core.ingest).toHaveBeenCalledTimes(1);
  });
});
