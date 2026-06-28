import { useEffect, useState } from "react";

import { getJSON, Ticking } from "../components";
import {
  connectorMonogram,
  formatLatency,
  formatUsd,
  itemsIngestedSince,
  runKindLabel,
  timeAgo,
  type ConnectorView,
  type MetricsView,
  type RunView,
  type SandboxState,
  type Route,
} from "../ui";

export const OVERVIEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const OVERVIEW_ITEMS_THIS_WEEK_COPY = {
  label: "Items this week",
  foot: "Brought in by your connectors",
} as const;

export interface OverviewRequestUrls {
  sinceMs: number;
  metrics: string;
  connectors: string;
  recentRuns: string;
  syncRuns: string;
}

export function overviewRequestUrls(nowMs: number = Date.now()): OverviewRequestUrls {
  const sinceMs = nowMs - OVERVIEW_WINDOW_MS;
  const since = new Date(sinceMs).toISOString();
  return {
    sinceMs,
    metrics: `/api/metrics?since=${encodeURIComponent(since)}`,
    connectors: "/api/connectors",
    recentRuns: "/api/runs?limit=8",
    syncRuns: "/api/runs?kind=connector_sync&limit=200",
  };
}

export interface OverviewSummary {
  decided: number;
  openQuestions: number;
  entities: number;
  flowingConnectors: number;
  erroringConnectors: number;
  itemsThisWeek: number | null;
}

export function summarizeOverview({
  state,
  connectors,
  syncRuns,
  sinceMs,
  itemsThisWeek,
}: {
  state: SandboxState;
  connectors: ConnectorView[];
  syncRuns?: RunView[];
  sinceMs?: number;
  itemsThisWeek?: number | null;
}): OverviewSummary {
  return {
    decided: state.decisions.filter((d) => d.status === "decided").length,
    openQuestions: state.questions.length,
    entities: state.entities.length,
    flowingConnectors: connectors.filter((c) => c.enabled).length,
    erroringConnectors: connectors.filter((c) => c.lastStatus === "error").length,
    itemsThisWeek:
      itemsThisWeek ??
      (syncRuns && sinceMs !== undefined ? itemsIngestedSince(syncRuns, sinceMs) : null),
  };
}

/**
 * The dashboard a founder opens every morning: what the brain holds, what
 * flowed in this week, whether the flow is healthy, what it cost, and what
 * just happened. Composed entirely from the existing read endpoints; the web
 * tallies for display only.
 */
export function OverviewView({
  state,
  navigate,
}: {
  state: SandboxState;
  navigate: (route: Route) => void;
}): JSX.Element {
  const [metrics, setMetrics] = useState<MetricsView | null>(null);
  const [connectors, setConnectors] = useState<ConnectorView[]>([]);
  const [recent, setRecent] = useState<RunView[]>([]);
  const [weekItems, setWeekItems] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const urls = overviewRequestUrls();
    void Promise.all([
      getJSON<MetricsView>(urls.metrics),
      getJSON<ConnectorView[]>(urls.connectors),
      getJSON<RunView[]>(urls.recentRuns),
      getJSON<RunView[]>(urls.syncRuns),
    ])
      .then(([m, c, r, syncs]) => {
        if (!alive) return;
        setMetrics(m);
        setConnectors(c);
        setRecent(r);
        setWeekItems(itemsIngestedSince(syncs, urls.sinceMs));
      })
      .catch(() => {
        if (alive) setWeekItems(0);
      });
    return () => {
      alive = false;
    };
  }, []);

  const summary = summarizeOverview({ state, connectors, itemsThisWeek: weekItems });

  return (
    <div className="view view-overview">
      <header className="view-head">
        <div>
          <h1 className="view-title">Overview</h1>
          <p className="view-sub">The room, distilled. What the brain holds this morning.</p>
        </div>
      </header>

      <section className="stat-grid" aria-label="At a glance">
        <StatCard onClick={() => navigate("graph")} tone="decided">
          <Ticking value={summary.decided} className="stat-num" />
          <span className="stat-label">Decided</span>
          <span className="stat-foot">Facts a human stands behind</span>
        </StatCard>
        <StatCard onClick={() => navigate("questions")} tone="open">
          <Ticking value={summary.openQuestions} className="stat-num" />
          <span className="stat-label">Open</span>
          <span className="stat-foot">Questions to settle</span>
        </StatCard>
        <StatCard onClick={() => navigate("graph")}>
          <Ticking value={summary.entities} className="stat-num" />
          <span className="stat-label">Entities</span>
          <span className="stat-foot">Things the room talks about</span>
        </StatCard>
        <StatCard onClick={() => navigate("connectors")} tone="accent">
          <span className="stat-num">
            {summary.itemsThisWeek === null ? "—" : summary.itemsThisWeek.toLocaleString()}
          </span>
          <span className="stat-label">{OVERVIEW_ITEMS_THIS_WEEK_COPY.label}</span>
          <span className="stat-foot">{OVERVIEW_ITEMS_THIS_WEEK_COPY.foot}</span>
        </StatCard>
      </section>

      <div className="overview-cols">
        <section className="panel" aria-label="Connector health">
          <div className="panel-head-row">
            <h2>Connector health</h2>
            <button className="link-btn" onClick={() => navigate("connectors")}>
              All connectors →
            </button>
          </div>
          {connectors.length === 0 ? (
            <p className="empty small">No connectors yet.</p>
          ) : (
            <ul className="health-strip">
              {connectors.map((c) => (
                <li
                  key={c.name}
                  className={`health-item ${c.lastStatus}${c.enabled ? "" : " off"}`}
                >
                  <span className="connector-glyph small" aria-hidden>
                    {connectorMonogram(c.kind)}
                  </span>
                  <span className="health-name">{c.name}</span>
                  <span className="health-meta">
                    {c.totalItems.toLocaleString()} items · {timeAgo(c.lastRunAt)}
                  </span>
                  <span className={`status-dot ${c.lastStatus}`} aria-label={c.lastStatus} />
                </li>
              ))}
            </ul>
          )}
          {summary.erroringConnectors > 0 && (
            <p className="health-warn" role="alert">
              {summary.erroringConnectors} connector
              {summary.erroringConnectors === 1 ? "" : "s"} need
              {summary.erroringConnectors === 1 ? "s" : ""} attention.
            </p>
          )}
        </section>

        <section className="panel" aria-label="This week">
          <div className="panel-head-row">
            <h2>This week</h2>
            <button className="link-btn" onClick={() => navigate("observability")}>
              Observability →
            </button>
          </div>
          <div className="week-stats">
            <div className="week-stat">
              <span className="week-value accent">
                {metrics ? formatUsd(metrics.totalCostUsd) : "—"}
              </span>
              <span className="week-label">Model cost</span>
            </div>
            <div className="week-stat">
              <span className="week-value">{metrics ? metrics.count.toLocaleString() : "—"}</span>
              <span className="week-label">Runs</span>
            </div>
            <div className="week-stat">
              <span className="week-value">
                {metrics ? formatLatency(metrics.p95LatencyMs) : "—"}
              </span>
              <span className="week-label">P95 latency</span>
            </div>
            <div className="week-stat">
              <span className="week-value">{summary.flowingConnectors}</span>
              <span className="week-label">Connectors on</span>
            </div>
          </div>
        </section>
      </div>

      <section className="panel" aria-label="Recent activity">
        <div className="panel-head-row">
          <h2>Recent activity</h2>
          <button className="link-btn" onClick={() => navigate("observability")}>
            All runs →
          </button>
        </div>
        {recent.length === 0 ? (
          <p className="empty small">No runs yet.</p>
        ) : (
          <ul className="activity-feed">
            {recent.map((r) => (
              <li key={r.id} className="activity-row">
                <span className={`status-dot ${r.status}`} aria-label={r.status} />
                <span className={`kind-pill k-${r.kind}`}>{runKindLabel(r.kind)}</span>
                <span className="activity-label">{r.label ?? r.id}</span>
                <span className="activity-when">{timeAgo(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({
  children,
  onClick,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "decided" | "open" | "accent";
}): JSX.Element {
  return (
    <button className={`stat-card${tone ? ` ${tone}` : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}
