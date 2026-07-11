import { describe, expect, it } from "vitest";

import { filterGraph } from "./views/Graph";
import { layoutGraph, type SandboxState } from "./ui";

const confidence = { value: 0.8, source: "model" as const };
const provenance = [{ evidenceId: "ev_graph", start: 0, end: 12 }];

function graphState(): Pick<SandboxState, "decisions" | "entities"> {
  return {
    decisions: [
      {
        id: "dec_magic",
        kind: "decision",
        title: "Magic-link login only",
        rationale: "Password login is out of scope",
        constraint: true,
        status: "decided",
        confidence,
        provenance,
      },
      {
        id: "dec_shift",
        kind: "decision",
        title: "Desk staff sessions",
        rationale: "Shift handoff is unresolved",
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
        description: "Identity and access",
        status: "decided",
        confidence,
        provenance,
      },
      {
        id: "ent_kiosk",
        kind: "entity",
        name: "Kiosk",
        description: "Front desk terminal",
        status: "open",
        confidence,
        provenance,
      },
    ],
  };
}

describe("filterGraph", () => {
  it("returns every loaded fact for an empty or whitespace query", () => {
    const filtered = filterGraph(graphState(), "   ");
    expect(filtered.decisions.map((d) => d.id)).toEqual(["dec_magic", "dec_shift"]);
    expect(filtered.entities.map((e) => e.id)).toEqual(["ent_auth", "ent_kiosk"]);
  });

  it("matches decision title, rationale and status case-insensitively", () => {
    expect(filterGraph(graphState(), "magic").decisions.map((d) => d.id)).toEqual(["dec_magic"]);
    expect(filterGraph(graphState(), "PASSWORD").decisions.map((d) => d.id)).toEqual(["dec_magic"]);
    expect(filterGraph(graphState(), "OPEN").decisions.map((d) => d.id)).toEqual(["dec_shift"]);
  });

  it("matches entity name, description and status case-insensitively", () => {
    expect(filterGraph(graphState(), "auth").entities.map((e) => e.id)).toEqual(["ent_auth"]);
    expect(filterGraph(graphState(), "TERMINAL").entities.map((e) => e.id)).toEqual(["ent_kiosk"]);
    expect(filterGraph(graphState(), "OPEN").entities.map((e) => e.id)).toEqual(["ent_kiosk"]);
  });

  it("returns empty lists when nothing matches", () => {
    const filtered = filterGraph(graphState(), "billing");
    expect(filtered.decisions).toEqual([]);
    expect(filtered.entities).toEqual([]);
  });
});

describe("layoutGraph", () => {
  const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const edges = [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
  ];

  it("is deterministic: the same graph lays out identically every time", () => {
    const one = layoutGraph(nodes, edges);
    const two = layoutGraph(nodes, edges);
    expect([...one.entries()]).toEqual([...two.entries()]);
  });

  it("places every node inside the frame", () => {
    const pos = layoutGraph(nodes, edges, { width: 1000, height: 1000 });
    expect(pos.size).toBe(4);
    for (const p of pos.values()) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1000);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1000);
    }
  });

  it("handles empty and single-node graphs", () => {
    expect(layoutGraph([], []).size).toBe(0);
    const solo = layoutGraph([{ id: "solo" }], []);
    expect(solo.size).toBe(1);
    expect(solo.get("solo")).toEqual({ x: 500, y: 500 });
  });

  it("ignores edges that point at missing nodes without throwing", () => {
    const pos = layoutGraph(nodes, [{ from: "a", to: "ghost" }]);
    expect(pos.size).toBe(4);
  });
});
