import { describe, expect, it } from "vitest";

import { filterGraph } from "./views/Graph";
import type { SandboxState } from "./ui";

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
