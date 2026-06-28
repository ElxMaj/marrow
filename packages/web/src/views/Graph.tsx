import { useMemo, useState } from "react";

import {
  decisionView,
  entityView,
  NodeCard,
  prefetchTrace,
  Skeleton,
  SourcePanel,
  useTrace,
} from "../components";
import { type SandboxState } from "../ui";

export interface GraphFilterResult {
  decisions: SandboxState["decisions"];
  entities: SandboxState["entities"];
}

export function filterGraph(
  state: Pick<SandboxState, "decisions" | "entities">,
  query: string,
): GraphFilterResult {
  const q = query.trim().toLowerCase();
  return {
    decisions: state.decisions.filter(
      (d) =>
        !q ||
        d.title.toLowerCase().includes(q) ||
        (d.rationale ?? "").toLowerCase().includes(q) ||
        d.status.toLowerCase().includes(q),
    ),
    entities: state.entities.filter(
      (e) =>
        !q ||
        e.name.toLowerCase().includes(q) ||
        (e.description ?? "").toLowerCase().includes(q) ||
        e.status.toLowerCase().includes(q),
    ),
  };
}

/**
 * Browse the distilled graph: every decided-vs-open fact with its provenance,
 * one filterable surface. The search is a pure client-side filter over the
 * loaded graph (presentation, not retrieval): no new endpoint, no logic in the
 * web. Clicking any card traces it back to the exact source span.
 */
export function GraphView({
  state,
  status,
}: {
  state: SandboxState;
  status: "loading" | "ready" | "error";
}): JSX.Element {
  const [query, setQuery] = useState("");
  const { active, open, close } = useTrace();

  const q = query.trim();
  const { decisions, entities } = useMemo(
    () => filterGraph({ decisions: state.decisions, entities: state.entities }, query),
    [state.decisions, state.entities, query],
  );

  const total = decisions.length + entities.length;

  return (
    <div className="view view-graph">
      <header className="view-head">
        <div>
          <h1 className="view-title">The graph</h1>
          <p className="view-sub">
            Every distilled fact, decided or open, traced to the exact line of the room it came
            from.
          </p>
        </div>
        <div className="graph-search">
          <SearchIcon />
          <input
            className="search-input"
            type="search"
            placeholder="Filter decisions and entities…"
            aria-label="Filter the graph"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </header>

      {status === "loading" && <Skeleton rows={3} />}

      {status === "ready" && total === 0 && (
        <p className="empty">{q ? "Nothing matches that." : "The graph is empty."}</p>
      )}

      {decisions.length > 0 && (
        <section aria-label="Decisions">
          <div className="section-head">
            <h2>Decisions</h2>
            <span className="section-count">{decisions.length}</span>
          </div>
          <ul className="cards graph-grid">
            {decisions.map((d) => {
              const v = decisionView(d);
              return (
                <li key={d.id}>
                  <NodeCard
                    view={v}
                    onTrace={(instant) => open(v, instant)}
                    onIntent={() => prefetchTrace(d.id)}
                    lit={active?.node.id === d.id}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {entities.length > 0 && (
        <section aria-label="Entities">
          <div className="section-head">
            <h2>Entities</h2>
            <span className="section-count">{entities.length}</span>
          </div>
          <ul className="cards graph-grid">
            {entities.map((e) => {
              const v = entityView(e);
              return (
                <li key={e.id}>
                  <NodeCard
                    view={v}
                    onTrace={(instant) => open(v, instant)}
                    onIntent={() => prefetchTrace(e.id)}
                    lit={active?.node.id === e.id}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {active && (
        <SourcePanel
          node={active.node}
          trace={active.trace}
          instant={active.instant}
          onClose={close}
        />
      )}
    </div>
  );
}

function SearchIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </svg>
  );
}
