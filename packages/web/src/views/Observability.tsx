import { useCallback, useEffect, useState } from "react";

import { CloseIcon, getJSON, reduceMotion } from "../components";
import {
  errorRate,
  formatLatency,
  formatTokens,
  formatUsd,
  RUN_KINDS,
  runKindLabel,
  timeAgo,
  type MetricsView,
  type RunKind,
  type RunStatus,
  type RunView,
} from "../ui";

/**
 * Langfuse-parity observability over Marrow's own pipeline: the metrics header
 * (runs, error rate, latency percentiles, cost, tokens) and the runs table with
 * filter chips and a detail drawer. Every number is read from the append-only
 * run trace through /api/metrics and /api/runs; the web computes nothing.
 */
export function ObservabilityView(): JSX.Element {
  const [metrics, setMetrics] = useState<MetricsView | null>(null);
  const [runs, setRuns] = useState<RunView[]>([]);
  const [kind, setKind] = useState<RunKind | "all">("all");
  const [status, setStatus] = useState<RunStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<RunView | null>(null);

  const loadRuns = useCallback(async () => {
    const params = new URLSearchParams({ limit: "200" });
    if (kind !== "all") params.set("kind", kind);
    if (status !== "all") params.set("status", status);
    const rows = await getJSON<RunView[]>(`/api/runs?${params.toString()}`);
    setRuns(rows);
  }, [kind, status]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([getJSON<MetricsView>("/api/metrics"), loadRuns()])
      .then(([m]) => {
        if (!alive) return;
        setMetrics(m);
        setError(false);
      })
      .catch(() => alive && setError(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [loadRuns]);

  return (
    <div className="view view-obs">
      <header className="view-head">
        <div>
          <h1 className="view-title">Observability</h1>
          <p className="view-sub">
            Every distill, retrieval, drift scan and connector sync, traced. The cost of turning the
            room into product truth, measured in the same Postgres.
          </p>
        </div>
      </header>

      <section className="metric-strip" aria-label="Pipeline metrics">
        <Metric label="runs" value={metrics ? metrics.count.toLocaleString() : "—"} />
        <Metric
          label="error rate"
          value={metrics ? `${errorRate(metrics.count, metrics.errorCount)}%` : "—"}
          {...(metrics && metrics.errorCount > 0 ? { tone: "warn" as const } : {})}
        />
        <Metric label="p50 latency" value={metrics ? formatLatency(metrics.p50LatencyMs) : "—"} />
        <Metric label="p95 latency" value={metrics ? formatLatency(metrics.p95LatencyMs) : "—"} />
        <Metric label="total cost" value={metrics ? formatUsd(metrics.totalCostUsd) : "—"} accent />
        <Metric
          label="tokens"
          value={metrics ? formatTokens(metrics.totalTokensIn + metrics.totalTokensOut) : "—"}
        />
      </section>

      <div className="obs-controls">
        <div className="chips" role="group" aria-label="Filter by kind">
          <Chip active={kind === "all"} onClick={() => setKind("all")}>
            all kinds
          </Chip>
          {RUN_KINDS.map((k) => (
            <Chip key={k} active={kind === k} onClick={() => setKind(k)}>
              {runKindLabel(k)}
            </Chip>
          ))}
        </div>
        <div className="chips" role="group" aria-label="Filter by status">
          <Chip active={status === "all"} onClick={() => setStatus("all")}>
            any status
          </Chip>
          <Chip active={status === "ok"} onClick={() => setStatus("ok")}>
            ok
          </Chip>
          <Chip active={status === "error"} onClick={() => setStatus("error")} tone="warn">
            error
          </Chip>
        </div>
      </div>

      {error ? (
        <p className="empty">Could not load the run trace.</p>
      ) : loading ? (
        <div className="table-skeleton" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="row-skeleton" />
          ))}
        </div>
      ) : runs.length === 0 ? (
        <p className="empty">No runs match this filter.</p>
      ) : (
        <div className="runs-table" role="table" aria-label="Runs">
          <div className="runs-row runs-head" role="row">
            <span role="columnheader">Time</span>
            <span role="columnheader">Kind</span>
            <span role="columnheader">Label</span>
            <span role="columnheader">Model</span>
            <span role="columnheader" className="num">
              tokens
            </span>
            <span role="columnheader" className="num">
              cost
            </span>
            <span role="columnheader" className="num">
              latency
            </span>
          </div>
          {runs.map((r) => (
            <button
              key={r.id}
              className={`runs-row${r.status === "error" ? " is-error" : ""}${
                open?.id === r.id ? " lit" : ""
              }`}
              role="row"
              onClick={() => setOpen(r)}
            >
              <span role="cell" className="run-time">
                <StatusDot status={r.status} />
                {timeAgo(r.createdAt)}
              </span>
              <span role="cell">
                <span className={`kind-pill k-${r.kind}`}>{runKindLabel(r.kind)}</span>
              </span>
              <span role="cell" className="run-label">
                {r.label ?? <span className="muted">—</span>}
              </span>
              <span role="cell" className="run-model">
                {r.model ?? <span className="muted">—</span>}
              </span>
              <span role="cell" className="num">
                {r.tokensIn !== undefined || r.tokensOut !== undefined ? (
                  formatTokens((r.tokensIn ?? 0) + (r.tokensOut ?? 0))
                ) : (
                  <span className="muted">—</span>
                )}
              </span>
              <span role="cell" className="num">
                {r.costUsd !== undefined ? formatUsd(r.costUsd) : <span className="muted">—</span>}
              </span>
              <span role="cell" className="num">
                {formatLatency(r.latencyMs)}
              </span>
            </button>
          ))}
        </div>
      )}

      {open && <RunDrawer run={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
  tone,
}: {
  label: string;
  value: string;
  accent?: boolean;
  tone?: "warn";
}): JSX.Element {
  return (
    <div className={`metric${accent ? " accent" : ""}${tone === "warn" ? " warn" : ""}`}>
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}

function Chip({
  active,
  onClick,
  tone,
  children,
}: {
  active: boolean;
  onClick: () => void;
  tone?: "warn";
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      className={`chip${active ? " active" : ""}${tone === "warn" ? " warn" : ""}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function StatusDot({ status }: { status: RunStatus }): JSX.Element {
  return <span className={`status-dot ${status}`} aria-label={status} />;
}

/** The run detail drawer, reusing the source-panel surface and motion so a run
 *  Opens with the same craft as a trace. */
function RunDrawer({ run, onClose }: { run: RunView; onClose: () => void }): JSX.Element {
  const [closing, setClosing] = useState(false);
  const close = useCallback(() => {
    if (reduceMotion()) return onClose();
    setClosing(true);
    setTimeout(onClose, 140);
  }, [onClose]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const meta = run.metadata ?? {};
  const metaEntries = Object.entries(meta);

  return (
    <div
      className={`scrim${closing ? " closing" : ""}`}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <aside
        className={`source-panel${closing ? " closing" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={`run ${run.id}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-head">
          <div className="panel-fact">
            <span className="panel-eyebrow">
              {runKindLabel(run.kind)} · {run.status}
            </span>
            <span className="panel-title">{run.label ?? run.id}</span>
          </div>
          <button className="close" onClick={close} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <dl className="run-detail">
          <Detail label="id" mono value={run.id} />
          <Detail label="when" value={`${timeAgo(run.createdAt)} · ${run.createdAt}`} />
          {run.model && <Detail label="model" mono value={run.model} />}
          <Detail label="latency" value={formatLatency(run.latencyMs)} />
          {run.tokensIn !== undefined && (
            <Detail label="tokens in" value={run.tokensIn.toLocaleString()} />
          )}
          {run.tokensOut !== undefined && (
            <Detail label="tokens out" value={run.tokensOut.toLocaleString()} />
          )}
          {run.costUsd !== undefined && <Detail label="cost" value={formatUsd(run.costUsd)} />}
        </dl>

        {run.inputSummary && (
          <div className="run-block">
            <p className="run-block-label">Input</p>
            <p className="run-block-body">{run.inputSummary}</p>
          </div>
        )}
        {run.outputSummary && (
          <div className="run-block">
            <p className="run-block-label">Output</p>
            <p className="run-block-body">{run.outputSummary}</p>
          </div>
        )}
        {run.error && (
          <div className="run-block error">
            <p className="run-block-label">Error</p>
            <p className="run-block-body">{run.error}</p>
          </div>
        )}
        {metaEntries.length > 0 && (
          <div className="run-block">
            <p className="run-block-label">Metadata</p>
            <pre className="run-meta">{JSON.stringify(meta, null, 2)}</pre>
          </div>
        )}
      </aside>
    </div>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd className={mono ? "mono" : undefined}>{value}</dd>
    </div>
  );
}
