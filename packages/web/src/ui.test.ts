import { describe, expect, it } from "vitest";

import {
  canActOnCatch,
  catchActionBody,
  copyTextWithFallback,
  itemsIngestedSince,
  confidencePct,
  connectorMonogram,
  errorRate,
  formatConfidence,
  formatLatency,
  formatTokens,
  formatUsd,
  hasUnsavedWork,
  parseRoute,
  provenanceWeight,
  registerUnsavedGuard,
  resolveInitialTheme,
  ROUTES,
  runKindLabel,
  sandboxPromote,
  shortId,
  syncItems,
  timeAgo,
  type RunView,
  type SandboxState,
} from "./ui";

// These helpers encode the few real decisions the view makes about how truth is
// shown: which theme to boot into, how heavy a fact's provenance reads, and how
// an exact machine value (confidence, evidence id) is rendered in the mono voice.
// They are pure so they can be trusted without a browser.

describe("resolveInitialTheme", () => {
  it("honours an explicit stored choice over the OS preference", () => {
    expect(resolveInitialTheme("light", true)).toBe("light");
    expect(resolveInitialTheme("dark", false)).toBe("dark");
  });

  it("falls back to the OS preference when nothing is stored", () => {
    expect(resolveInitialTheme(null, true)).toBe("dark");
    expect(resolveInitialTheme(null, false)).toBe("light");
  });

  it("ignores a junk stored value and uses the OS preference", () => {
    expect(resolveInitialTheme("chartreuse", false)).toBe("light");
    expect(resolveInitialTheme("", true)).toBe("dark");
  });
});

// Goals is the headline space and must be a first-class, navigable route, so the
// hash router resolves #/goals to it and the sidebar can list it.
describe("goals route", () => {
  it("is a known route the hash router resolves", () => {
    expect(ROUTES).toContain("goals");
    expect(parseRoute("#/goals")).toBe("goals");
  });

  it("defaults unknown and empty hashes to overview", () => {
    expect(parseRoute("")).toBe("overview");
    expect(parseRoute("#/missing")).toBe("overview");
    expect(parseRoute("#/connectors?tab=sync")).toBe("connectors");
  });
});

describe("provenanceWeight", () => {
  // a fact backed by nine spans must out-weigh one backed by a single span, so
  // the gold provenance rule can scale and trust becomes something you can scan.
  it("buckets span count into three weights", () => {
    expect(provenanceWeight(0)).toBe(1);
    expect(provenanceWeight(1)).toBe(1);
    expect(provenanceWeight(2)).toBe(2);
    expect(provenanceWeight(3)).toBe(2);
    expect(provenanceWeight(4)).toBe(3);
    expect(provenanceWeight(9)).toBe(3);
  });
});

describe("formatConfidence", () => {
  // confidence is a machine-exact value shown in the mono voice; always two
  // decimals so the column aligns under tabular figures.
  it("renders a 0..1 value as a fixed two-decimal string", () => {
    expect(formatConfidence(0.82)).toBe("0.82");
    expect(formatConfidence(1)).toBe("1.00");
    expect(formatConfidence(0)).toBe("0.00");
    expect(formatConfidence(0.6)).toBe("0.60");
  });
});

describe("confidencePct", () => {
  it("maps a 0..1 value to a whole-percent meter width", () => {
    expect(confidencePct(0.82)).toBe(82);
    expect(confidencePct(1)).toBe(100);
    expect(confidencePct(0)).toBe(0);
  });
});

// the read-only demo must still deliver the one sacred moment: answering a
// question and watching it become decided. sandboxPromote mirrors the server's
// answer() semantics exactly, client-side and unpersisted, so the hosted demo
// performs the real choreography without writing anything.
describe("sandboxPromote", () => {
  const conf = (value: number) => ({ value, source: "model" as const });
  const span = { evidenceId: "ev_1", start: 0, end: 10 };
  const base = (): SandboxState => ({
    decisions: [
      {
        id: "dec_a",
        kind: "decision",
        title: "shift change",
        rationale: "",
        constraint: false,
        status: "open",
        confidence: conf(0.55),
        provenance: [span],
      },
      {
        id: "dec_b",
        kind: "decision",
        title: "idle timeout",
        rationale: "",
        constraint: false,
        status: "open",
        confidence: conf(0.55),
        provenance: [span],
      },
    ],
    entities: [
      {
        id: "ent_a",
        kind: "entity",
        name: "kiosk",
        status: "open",
        confidence: conf(0.7),
        provenance: [span],
      },
    ],
    questions: [
      {
        id: "q_conflict",
        kind: "question",
        prompt: "which holds?",
        relatesTo: ["dec_a", "dec_b"],
        status: "open",
        confidence: conf(0.6),
        provenance: [span],
      },
      {
        id: "q_entity",
        kind: "question",
        prompt: "specify the kiosk?",
        relatesTo: ["ent_a"],
        status: "open",
        confidence: conf(0.6),
        provenance: [span],
      },
      {
        id: "q_free",
        kind: "question",
        prompt: "no-show fee?",
        status: "open",
        confidence: conf(0.6),
        provenance: [span],
      },
    ],
    readOnly: true,
  });

  it("promotes the single related node to decided with a human confidence", () => {
    const result = sandboxPromote(base(), "q_entity", "the lobby tablet");
    expect(result).not.toBeNull();
    const entity = result!.state.entities.find((e) => e.id === "ent_a")!;
    expect(entity.status).toBe("decided");
    expect(entity.confidence).toEqual({ value: 1, source: "human" });
    expect(result!.promotedIds).toEqual(["ent_a"]);
    expect(result!.state.questions.map((q) => q.id)).not.toContain("q_entity");
  });

  it("appends the answer as one more provenance span, like the real promote", () => {
    const result = sandboxPromote(base(), "q_entity", "the lobby tablet");
    const entity = result!.state.entities.find((e) => e.id === "ent_a")!;
    expect(entity.provenance).toHaveLength(2);
  });

  it("a conflict needs the chosen side: promotes it, supersedes the other", () => {
    const result = sandboxPromote(base(), "q_conflict", "shift change holds", "dec_a");
    expect(result).not.toBeNull();
    const a = result!.state.decisions.find((d) => d.id === "dec_a")!;
    const b = result!.state.decisions.find((d) => d.id === "dec_b")!;
    expect(a.status).toBe("decided");
    expect(b.status).toBe("superseded");
    expect(result!.promotedIds).toEqual(["dec_a"]);
  });

  it("refuses a conflict without a chosen side, both sides are never promoted", () => {
    expect(sandboxPromote(base(), "q_conflict", "both sound fine")).toBeNull();
  });

  it("a question with no related nodes closes without promoting anything", () => {
    const result = sandboxPromote(base(), "q_free", "ten zloty");
    expect(result).not.toBeNull();
    expect(result!.promotedIds).toEqual([]);
    expect(result!.state.questions.map((q) => q.id)).not.toContain("q_free");
    expect(result!.state.decisions.every((d) => d.status !== "decided")).toBe(true);
  });

  it("returns null for an unknown question", () => {
    expect(sandboxPromote(base(), "q_missing", "answer")).toBeNull();
  });

  it("does not mutate the input state", () => {
    const state = base();
    sandboxPromote(state, "q_conflict", "shift change holds", "dec_a");
    expect(state.decisions.find((d) => d.id === "dec_a")!.status).toBe("open");
    expect(state.questions).toHaveLength(3);
  });
});

describe("shortId", () => {
  // evidence/node ids are long uuids; the footer shows a stable, copy-recognisable
  // head (prefix + first 8 hex), the full id still lives in the trace panel.
  it("keeps the kind prefix and the first eight hex of the uuid", () => {
    expect(shortId("ev_aabe4c3f-1508-44e4-b1b9-8486ecb23f87")).toBe("ev_aabe4c3f");
    expect(shortId("dec_03d54db6-1781-44b0-a9f0-6b1f1161ccc4")).toBe("dec_03d54db6");
  });

  it("leaves a short prefixless id alone", () => {
    expect(shortId("plain")).toBe("plain");
  });
});

describe("copyTextWithFallback", () => {
  it("writes to the clipboard when the API is available", async () => {
    const written: string[] = [];

    const result = await copyTextWithFallback(
      "brain@inbound.marrowhq.com",
      { id: "inbound" },
      {
        clipboard: {
          writeText: async (text) => {
            written.push(text);
          },
        },
      },
    );

    expect(result).toBe("clipboard");
    expect(written).toEqual(["brain@inbound.marrowhq.com"]);
  });

  it("selects the target text when clipboard access is denied", async () => {
    const calls: string[] = [];
    const target = { textContent: "brain@inbound.marrowhq.com" };
    const range = { id: "range" };

    const result = await copyTextWithFallback("brain@inbound.marrowhq.com", target, {
      clipboard: {
        writeText: async () => {
          throw new Error("clipboard denied");
        },
      },
      selection: {
        removeAllRanges: () => calls.push("remove"),
        addRange: (value) => calls.push(value === range ? "add" : "wrong range"),
      },
      createRange: () => range,
      selectRangeContents: (value, node) => {
        expect(value).toBe(range);
        expect(node).toBe(target);
        calls.push("select");
      },
    });

    expect(result).toBe("selection");
    expect(calls).toEqual(["select", "remove", "add"]);
  });

  it("falls back when clipboard access never settles", async () => {
    const calls: string[] = [];
    const target = { textContent: "brain@inbound.marrowhq.com" };
    const range = { id: "range" };

    const result = await copyTextWithFallback("brain@inbound.marrowhq.com", target, {
      clipboard: {
        writeText: () => new Promise<void>(() => {}),
      },
      clipboardTimeoutMs: 0,
      selection: {
        removeAllRanges: () => calls.push("remove"),
        addRange: (value) => calls.push(value === range ? "add" : "wrong range"),
      },
      createRange: () => range,
      selectRangeContents: (value, node) => {
        expect(value).toBe(range);
        expect(node).toBe(target);
        calls.push("select");
      },
    });

    expect(result).toBe("selection");
    expect(calls).toEqual(["select", "remove", "add"]);
  });

  it("returns none when neither clipboard nor selection is available", async () => {
    await expect(copyTextWithFallback("brain@inbound.marrowhq.com", null, {})).resolves.toBe(
      "none",
    );
  });
});

describe("console formatting", () => {
  it("formats usd with the precision the magnitude deserves", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.0042)).toBe("$0.0042");
    expect(formatUsd(12.8)).toBe("$12.80");
    expect(formatUsd(1840)).toBe("$1,840");
  });

  it("compacts token counts and latency", () => {
    expect(formatTokens(940)).toBe("940");
    expect(formatTokens(1840)).toBe("1.8k");
    expect(formatTokens(18400)).toBe("18k");
    expect(formatTokens(1_100_000)).toBe("1.1M");
    expect(formatLatency(42)).toBe("42ms");
    expect(formatLatency(1800)).toBe("1.8s");
  });

  it("renders relative time against an explicit now", () => {
    const now = Date.parse("2026-06-17T12:00:00Z");
    expect(timeAgo(undefined, now)).toBe("never");
    expect(timeAgo("2026-06-17T11:52:00Z", now)).toBe("8m ago");
    expect(timeAgo("2026-06-17T09:00:00Z", now)).toBe("3h ago");
    expect(timeAgo("2026-06-15T12:00:00Z", now)).toBe("2d ago");
  });

  it("computes the error rate as a whole percent", () => {
    expect(errorRate(0, 0)).toBe(0);
    expect(errorRate(50, 3)).toBe(6);
    expect(errorRate(56, 3)).toBe(5);
  });

  it("labels connector_sync as sync and gives each kind a monogram", () => {
    expect(runKindLabel("connector_sync")).toBe("sync");
    expect(runKindLabel("distill")).toBe("distill");
    expect(connectorMonogram("github")).toBe("Gh");
    expect(connectorMonogram("granola")).toBe("Gr");
  });

  it("sums sync items from run metadata", () => {
    expect(syncItems({ itemsIngested: 17 })).toBe(17);
    expect(syncItems(undefined)).toBe(0);
    expect(syncItems({})).toBe(0);
  });
});

// The Overview "items this week" stat sums itemsIngested across successful
// connector_sync runs in the window. It counts connector items brought in — NOT
// drift catches (which are a different concept surfaced in the Catches view), so
// the helper name and the label both say "items".
describe("itemsIngestedSince", () => {
  const run = (over: Partial<RunView>): RunView => ({
    id: "run_x",
    kind: "connector_sync",
    status: "ok",
    latencyMs: 1,
    createdAt: new Date(2_000_000).toISOString(),
    ...over,
  });

  it("sums itemsIngested across ok runs since the cutoff", () => {
    const runs = [
      run({ createdAt: new Date(5_000).toISOString(), metadata: { itemsIngested: 3 } }),
      run({ createdAt: new Date(9_000).toISOString(), metadata: { itemsIngested: 4 } }),
    ];
    expect(itemsIngestedSince(runs, 0)).toBe(7);
  });

  it("ignores runs before the cutoff and failed runs", () => {
    const runs = [
      run({ createdAt: new Date(100).toISOString(), metadata: { itemsIngested: 5 } }), // too old
      run({
        status: "error",
        createdAt: new Date(9_000).toISOString(),
        metadata: { itemsIngested: 9 },
      }),
      run({ createdAt: new Date(9_000).toISOString(), metadata: { itemsIngested: 2 } }),
    ];
    expect(itemsIngestedSince(runs, 1_000)).toBe(2);
  });
});

// The catch action contract: the server's accept route wants { resolution } and
// the dismiss route wants { reason } (api.ts). The console must send the field
// the route requires, or a dismiss 400s even when the user typed a reason.
describe("catchActionBody", () => {
  it("sends resolution for accept", () => {
    expect(catchActionBody("accept", "rewrote the migration")).toEqual({
      resolution: "rewrote the migration",
    });
  });

  it("sends reason (not resolution) for dismiss", () => {
    expect(catchActionBody("dismiss", "false positive, test fixture")).toEqual({
      reason: "false positive, test fixture",
    });
  });
});

// Whether the row should offer accept/dismiss is a property of the catch, not of
// the active filter: any open catch is actionable, including in the "all" tab.
describe("canActOnCatch", () => {
  it("is true for an open catch", () => {
    expect(canActOnCatch("open")).toBe(true);
  });

  it("is false once a catch is acted on or dismissed", () => {
    expect(canActOnCatch("acted-on")).toBe(false);
    expect(canActOnCatch("dismissed")).toBe(false);
  });
});

describe("unsaved-work guard registry", () => {
  it("reports unsaved work only while a dirty checker is registered and true", () => {
    let dirty = false;
    const unregister = registerUnsavedGuard(() => dirty);
    expect(hasUnsavedWork()).toBe(false);
    dirty = true;
    expect(hasUnsavedWork()).toBe(true);
    // the router asks before navigating; once the checker unregisters (view
    // unmount) the registry is clear even if the last value was dirty.
    unregister();
    expect(hasUnsavedWork()).toBe(false);
  });

  it("is true when any one of several views is dirty", () => {
    const offA = registerUnsavedGuard(() => false);
    const offB = registerUnsavedGuard(() => true);
    expect(hasUnsavedWork()).toBe(true);
    offB();
    expect(hasUnsavedWork()).toBe(false);
    offA();
  });
});
