import { useMemo, useRef, useState } from "react";

import {
  decisionView,
  entityView,
  NodeCard,
  type NodeView,
  prefetchTrace,
  Skeleton,
  SourcePanel,
  useTrace,
} from "../components";
import { type BrainGraphView, type GraphNodeView, layoutGraph, type SandboxState } from "../ui";

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

const VIEW = 1000; // the layout coordinate space, a square viewBox.

function nodeRadius(degree: number): number {
  return Math.min(22, 7 + degree * 1.8);
}

/**
 * The living map: the distilled brain as a node-link graph, laid out with a
 * dependency-free deterministic force simulation (see layoutGraph). Every node is
 * a dot sized by how connected it is and coloured by status; every edge is a
 * line. Drag to pan, use the zoom controls, click any node to trace it back to
 * the exact line of the room it came from. The search box lights the matches.
 */
function LivingMap({
  graph,
  query,
  onOpen,
  activeId,
}: {
  graph: BrainGraphView;
  query: string;
  onOpen: (node: GraphNodeView, instant: boolean) => void;
  activeId: string | undefined;
}): JSX.Element {
  const layout = useMemo(
    () => layoutGraph(graph.nodes, graph.edges, { width: VIEW, height: VIEW }),
    [graph],
  );
  const [tf, setTf] = useState({ scale: 1, tx: 0, ty: 0 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  // survives past pointerup so the click that follows a pan can be ignored.
  const panMoved = useRef(false);

  const q = query.trim().toLowerCase();
  const matches = (n: GraphNodeView): boolean =>
    !q || n.title.toLowerCase().includes(q) || n.status.toLowerCase().includes(q);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    // deliberately no setPointerCapture: capturing the pointer on the svg would
    // retarget every pointer event to it and swallow the click on a child node,
    // breaking click-to-trace. Panning works fine via bubbling move events, and
    // the drag threshold below tells a pan apart from a click.
    panMoved.current = false;
    drag.current = { x: e.clientX, y: e.clientY, tx: tf.tx, ty: tf.ty };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) panMoved.current = true;
    setTf((t) => ({ ...t, tx: d.tx + dx, ty: d.ty + dy }));
  };
  const onPointerUp = (): void => {
    drag.current = null;
  };
  const zoom = (factor: number): void =>
    setTf((t) => ({ ...t, scale: Math.max(0.4, Math.min(4, t.scale * factor)) }));
  const reset = (): void => setTf({ scale: 1, tx: 0, ty: 0 });

  // a click that followed a drag is a pan, not a selection.
  const clickNode = (n: GraphNodeView, instant: boolean): void => {
    if (panMoved.current) return;
    onOpen(n, instant);
  };

  return (
    <div className="map-wrap">
      <div className="map-controls" role="group" aria-label="Zoom">
        <button className="map-btn" onClick={() => zoom(1.25)} aria-label="Zoom in" type="button">
          +
        </button>
        <button className="map-btn" onClick={() => zoom(0.8)} aria-label="Zoom out" type="button">
          &minus;
        </button>
        <button className="map-btn" onClick={reset} aria-label="Reset view" type="button">
          Reset
        </button>
      </div>
      <svg
        className="map-svg"
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        role="img"
        aria-label="The brain as a knowledge graph"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <g transform={`translate(${tf.tx} ${tf.ty}) scale(${tf.scale})`}>
          <g className="map-edges">
            {graph.edges.map((edge, i) => {
              const a = layout.get(edge.from);
              const b = layout.get(edge.to);
              if (!a || !b) return null;
              return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="map-edge" />;
            })}
          </g>
          <g className="map-nodes">
            {graph.nodes.map((n) => {
              const p = layout.get(n.id);
              if (!p) return null;
              const r = nodeRadius(n.degree);
              const lit = matches(n);
              const isActive = n.id === activeId;
              const showLabel = n.degree >= 3 || isActive;
              return (
                <g
                  key={n.id}
                  className={`map-node status-${n.status}${lit ? "" : " dim"}${
                    isActive ? " active" : ""
                  }`}
                  transform={`translate(${p.x} ${p.y})`}
                  onClick={() => clickNode(n, false)}
                  onMouseEnter={() => prefetchTrace(n.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen(n, true);
                    }
                  }}
                >
                  <title>{`${n.kind}: ${n.title} (${n.degree} link${n.degree === 1 ? "" : "s"})`}</title>
                  <circle r={r} className="map-dot" />
                  {showLabel && (
                    <text className="map-label" x={r + 4} y={4}>
                      {n.title.length > 34 ? `${n.title.slice(0, 33)}…` : n.title}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>
      <ul className="map-legend" aria-hidden>
        <li className="status-decided">decided</li>
        <li className="status-open">open</li>
        <li className="status-contested">contested</li>
        <li className="status-superseded">superseded</li>
      </ul>
    </div>
  );
}

/**
 * Browse the distilled graph. Two ways in: the living map (a node-link galaxy of
 * every fact and the links between them) and the list (decided-vs-open cards).
 * The search is a pure client-side filter over the loaded graph, no new
 * retrieval. Clicking any node or card traces it to the exact source span.
 */
export function GraphView({
  state,
  status,
}: {
  state: SandboxState;
  status: "loading" | "ready" | "error";
}): JSX.Element {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"map" | "list">("map");
  const { active, open, close } = useTrace();

  const q = query.trim();
  const graph = state.graph ?? { nodes: [], edges: [] };

  const { decisions, entities } = useMemo(
    () => filterGraph({ decisions: state.decisions, entities: state.entities }, query),
    [state.decisions, state.entities, query],
  );
  const total = decisions.length + entities.length;

  // resolve a clicked graph node to its full view when it is a loaded decision
  // or entity (so the trace panel shows confidence and provenance); otherwise a
  // minimal view whose trace is still fetched by id.
  const decisionById = useMemo(
    () => new Map(state.decisions.map((d) => [d.id, d])),
    [state.decisions],
  );
  const entityById = useMemo(() => new Map(state.entities.map((e) => [e.id, e])), [state.entities]);
  const openNode = (n: GraphNodeView, instant: boolean): void => {
    const d = decisionById.get(n.id);
    if (d) return open(decisionView(d), instant);
    const e = entityById.get(n.id);
    if (e) return open(entityView(e), instant);
    const view: NodeView = {
      id: n.id,
      title: n.title,
      kind: n.kind,
      status: n.status,
      confidence: { value: 1, source: "model" },
      provenance: [],
    };
    open(view, instant);
  };

  return (
    <div className="view view-graph">
      <header className="view-head">
        <div>
          <h1 className="view-title">The graph</h1>
          <p className="view-sub">
            Every distilled fact and the links between them. It gets denser, and more useful, as the
            room grows.
          </p>
        </div>
        <div className="graph-tools">
          <div className="mode-toggle" role="group" aria-label="View mode">
            <button
              className={`mode-btn${mode === "map" ? " on" : ""}`}
              onClick={() => setMode("map")}
              type="button"
            >
              Map
            </button>
            <button
              className={`mode-btn${mode === "list" ? " on" : ""}`}
              onClick={() => setMode("list")}
              type="button"
            >
              List
            </button>
          </div>
          <div className="graph-search">
            <SearchIcon />
            <input
              className="search-input"
              type="search"
              placeholder="Filter the graph…"
              aria-label="Filter the graph"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
      </header>

      {status === "loading" && <Skeleton rows={3} />}

      {status === "ready" && mode === "map" && graph.nodes.length === 0 && (
        <p className="empty">
          The graph is empty. Ingest the room and links will form as it grows.
        </p>
      )}

      {status === "ready" && mode === "map" && graph.nodes.length > 0 && (
        <LivingMap graph={graph} query={query} onOpen={openNode} activeId={active?.node.id} />
      )}

      {mode === "list" && (
        <>
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
        </>
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
