import { type FormEvent, useCallback, useEffect, useState } from "react";

import { CloseIcon, getJSON, reduceMotion } from "../components";
import {
  canActOnCatch,
  catchActionBody,
  catchStatusLabel,
  formatConfidence,
  timeAgo,
  verdictLabel,
  type CatchMetricsView,
  type CatchView,
} from "../ui";

export type CatchFilter = "all" | "open" | "acted-on" | "dismissed";
type CatchAction = "accept" | "dismiss";

export function catchesForFilter(catches: CatchView[], filter: CatchFilter): CatchView[] {
  return catches.filter((c) => (filter === "all" ? true : c.status === filter));
}

export function catchesShowActionColumn(catches: CatchView[]): boolean {
  return catches.some((c) => canActOnCatch(c.status));
}

export function catchActionsDisabled(
  catch_: CatchView,
  {
    readOnly,
    acting,
  }: {
    readOnly: boolean;
    acting: string | null;
  },
): boolean {
  return readOnly || acting === catch_.id;
}

export function catchActionPrompt(action: CatchAction): string {
  return action === "accept" ? "What did you do about this drift?" : "Why is this noise?";
}

export function catchMetricPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function catchPrecisionTone(precision: number): "warn" | undefined {
  return precision < 0.8 ? "warn" : undefined;
}

export function catchDismissRateTone(dismissRate: number): "warn" | undefined {
  return dismissRate > 0.2 ? "warn" : undefined;
}

/** Metric tones gated on real activity. Precision and dismiss rate are ratios
 *  over resolved catches; before anything has been acted on or dismissed they
 *  are no-data, and a red 0% would read as failure instead of "nothing yet". */
export function catchMetricsTones(metrics: CatchMetricsView | null): {
  precision?: "warn";
  dismissRate?: "warn";
} {
  if (!metrics) return {};
  const resolved = metrics.actedOn + metrics.dismissed;
  if (resolved === 0) return {};
  const tones: { precision?: "warn"; dismissRate?: "warn" } = {};
  const precision = catchPrecisionTone(metrics.precision);
  if (precision) tones.precision = precision;
  const dismissRate = catchDismissRateTone(metrics.dismissRate);
  if (dismissRate) tones.dismissRate = dismissRate;
  return tones;
}

/**
 * The Catches view: drift detection receipts. Each row shows code that
 * contradicts a decided fact, with the offending hunk, the violated decision,
 * a verdict badge, confidence, and actions (accept/dismiss for open catches).
 * This is the wedge: the product's reason to exist made visible.
 */
export function CatchesView({ readOnly }: { readOnly: boolean }): JSX.Element {
  const [catches, setCatches] = useState<CatchView[]>([]);
  const [metrics, setMetrics] = useState<CatchMetricsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [filter, setFilter] = useState<CatchFilter>("all");
  const [open, setOpen] = useState<CatchView | null>(null);
  const [actionDraft, setActionDraft] = useState<{
    catch_: CatchView;
    action: CatchAction;
    text: string;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, m] = await Promise.all([
        getJSON<CatchView[]>("/api/catches"),
        getJSON<CatchMetricsView>("/api/catches/metrics"),
      ]);
      setCatches(c);
      setMetrics(m);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 3200);
    return () => clearTimeout(t);
  }, [note]);

  const startAction = useCallback(
    (c: CatchView, action: CatchAction) => {
      if (readOnly || acting || c.status !== "open") return;
      setActionDraft({ catch_: c, action, text: "" });
      setNote(null);
    },
    [readOnly, acting],
  );

  const submitAction = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!actionDraft) return;
      const resolution = actionDraft.text.trim();
      if (!resolution) return;
      const c = actionDraft.catch_;
      const action = actionDraft.action;
      setActing(c.id);
      try {
        const res = await fetch(`/api/catches/${encodeURIComponent(c.id)}/${action}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(catchActionBody(action, resolution)),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setNote(body.error ?? `Could not ${action} catch`);
        } else {
          setNote(
            action === "accept" ? `Accepted · marked as acted on` : `Dismissed · marked as noise`,
          );
          setActionDraft(null);
          await load();
        }
      } catch {
        setNote("Could not reach the server");
      } finally {
        setActing(null);
      }
    },
    [actionDraft, load],
  );

  const filtered = catchesForFilter(catches, filter);
  // The actions column shows whenever a visible catch is actionable, not only in
  // the "open" tab — an open catch in the "all" tab must still offer its actions.
  const hasActionable = catchesShowActionColumn(filtered);
  const metricTones = catchMetricsTones(metrics);
  const precisionTone = metricTones.precision;
  const dismissRateTone = metricTones.dismissRate;

  return (
    <div className="view view-catches">
      <header className="view-head">
        <div>
          <h1 className="view-title">Catches</h1>
          <p className="view-sub">
            Code that contradicts decided facts. Each row is a receipt: the hunk that triggered the
            drift signal, the decision it violates, and what you did about it.
          </p>
        </div>
      </header>

      {metrics && (
        <section className="metric-strip" aria-label="Catch metrics this week">
          <Metric label="Surfaced" value={metrics.surfaced.toLocaleString()} />
          <Metric label="Acted on" value={metrics.actedOn.toLocaleString()} />
          <Metric label="Dismissed" value={metrics.dismissed.toLocaleString()} />
          <Metric
            label="Precision"
            value={catchMetricPercent(metrics.precision)}
            {...(precisionTone ? { tone: precisionTone } : {})}
          />
          <Metric
            label="Dismiss rate"
            value={catchMetricPercent(metrics.dismissRate)}
            {...(dismissRateTone ? { tone: dismissRateTone } : {})}
          />
        </section>
      )}

      {note && (
        <div className="inline-note live" role="status">
          {note}
        </div>
      )}

      {readOnly && (
        <p className="inline-note">
          Read-only demo: actions are disabled. Run locally to accept/dismiss catches.
        </p>
      )}

      {actionDraft && (
        <form className="catch-action-form" aria-label="Resolve catch" onSubmit={submitAction}>
          <div className="catch-action-copy">
            <span className="panel-eyebrow">
              {actionDraft.action === "accept" ? "Mark acted on" : "Dismiss as noise"}
            </span>
            <strong>{actionDraft.catch_.decisionTitle}</strong>
            <span className="hunk-path">
              {actionDraft.catch_.path}:{actionDraft.catch_.lineStart}-{actionDraft.catch_.lineEnd}
            </span>
          </div>
          <label className="field">
            <span>{catchActionPrompt(actionDraft.action)}</span>
            <textarea
              value={actionDraft.text}
              onChange={(e) =>
                setActionDraft((draft) => (draft ? { ...draft, text: e.target.value } : draft))
              }
              rows={2}
              disabled={acting === actionDraft.catch_.id}
            />
          </label>
          <div className="add-actions">
            <button
              type="button"
              className="btn ghost"
              onClick={() => setActionDraft(null)}
              disabled={acting === actionDraft.catch_.id}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn"
              disabled={acting === actionDraft.catch_.id || !actionDraft.text.trim()}
            >
              {acting === actionDraft.catch_.id
                ? "Saving…"
                : actionDraft.action === "accept"
                  ? "Save action"
                  : "Dismiss catch"}
            </button>
          </div>
        </form>
      )}

      <div className="obs-controls">
        <div className="chips" role="group" aria-label="Filter by status">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            All
          </FilterChip>
          <FilterChip active={filter === "open"} onClick={() => setFilter("open")}>
            Open
          </FilterChip>
          <FilterChip active={filter === "acted-on"} onClick={() => setFilter("acted-on")}>
            Acted on
          </FilterChip>
          <FilterChip active={filter === "dismissed"} onClick={() => setFilter("dismissed")}>
            Dismissed
          </FilterChip>
        </div>
      </div>

      {error ? (
        <p className="empty">Could not load catches.</p>
      ) : loading ? (
        <div className="table-skeleton" aria-hidden>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="row-skeleton" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="empty">No catches match this filter.</p>
      ) : (
        <div className="catches-table" role="table" aria-label="Drift catches">
          <div className="catches-row catches-head" role="row">
            <span role="columnheader">Status</span>
            <span role="columnheader">Code hunk</span>
            <span role="columnheader">Violates</span>
            <span role="columnheader">Verdict</span>
            <span role="columnheader" className="num">
              Confidence
            </span>
            <span role="columnheader">Surfaced</span>
            {hasActionable && <span role="columnheader">Actions</span>}
          </div>
          {filtered.map((c) => (
            <button
              key={c.id}
              className={`catches-row${c.status === "open" ? " is-open" : ""}${
                open?.id === c.id ? " lit" : ""
              }`}
              role="row"
              onClick={() => setOpen(c)}
            >
              <span role="cell">
                <StatusBadge status={c.status} />
              </span>
              <span role="cell" className="catch-hunk">
                <span className="hunk-path">
                  {c.path}:{c.lineStart}-{c.lineEnd}
                </span>
                <span className="hunk-preview">{c.hunkText.slice(0, 80)}</span>
              </span>
              <span role="cell" className="catch-decision">
                <span className="decision-title">{c.decisionTitle}</span>
                <span className="decision-meta">{c.decisionSourceLabel}</span>
              </span>
              <span role="cell">
                <VerdictBadge verdict={c.verdict} />
              </span>
              <span role="cell" className="num">
                {formatConfidence(c.confidence)}
              </span>
              <span role="cell" className="when">
                {timeAgo(c.surfacedAt)}
              </span>
              {canActOnCatch(c.status) && (
                <span role="cell" className="actions">
                  <button
                    className="btn mini"
                    disabled={catchActionsDisabled(c, { readOnly, acting })}
                    onClick={(e) => {
                      e.stopPropagation();
                      startAction(c, "accept");
                    }}
                  >
                    {acting === c.id ? "acting…" : "acted on"}
                  </button>
                  <button
                    className="btn mini"
                    disabled={catchActionsDisabled(c, { readOnly, acting })}
                    onClick={(e) => {
                      e.stopPropagation();
                      startAction(c, "dismiss");
                    }}
                  >
                    dismiss
                  </button>
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {open && <CatchDrawer catch_={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}): JSX.Element {
  return (
    <div className={`metric${tone === "warn" ? " warn" : ""}`}>
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button className={`chip${active ? " active" : ""}`} aria-pressed={active} onClick={onClick}>
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: CatchView["status"] }): JSX.Element {
  return (
    <span className={`badge ${status === "open" ? "open" : status}`}>
      <span className="glyph" aria-hidden />
      {catchStatusLabel(status)}
    </span>
  );
}

function VerdictBadge({ verdict }: { verdict: "warn" | "contradiction" }): JSX.Element {
  const label = verdict === "contradiction" ? "contradicts" : "likely";
  return (
    <span className={`verdict-badge ${verdict}`}>
      <span className="glyph" aria-hidden />
      {label}
    </span>
  );
}

/** The catch detail drawer, showing the full hunk and the decision with its
 *  evidence source. reuses the source-panel surface and motion. */
function CatchDrawer({ catch_, onClose }: { catch_: CatchView; onClose: () => void }): JSX.Element {
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
        aria-label={`catch ${catch_.id}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-head">
          <div className="panel-fact">
            <span className="panel-eyebrow">Catch · {catchStatusLabel(catch_.status)}</span>
            <span className="panel-title">
              {catch_.path}:{catch_.lineStart}-{catch_.lineEnd}
            </span>
          </div>
          <button className="close" onClick={close} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="catch-detail">
          <div className="catch-section">
            <p className="catch-section-label">Offending code hunk</p>
            <pre className="catch-hunk-full">{catch_.hunkText}</pre>
            <p className="catch-meta">
              File: {catch_.path} · lines {catch_.lineStart}-{catch_.lineEnd} · surfaced{" "}
              {timeAgo(catch_.surfacedAt)}
            </p>
          </div>

          <div className="catch-section">
            <p className="catch-section-label">Violates decided fact</p>
            <blockquote className="catch-decision-full">
              <p className="decision-title-full">{catch_.decisionTitle}</p>
              <cite className="decision-source">{catch_.decisionSourceLabel}</cite>
            </blockquote>
          </div>

          <dl className="run-detail">
            <Detail label="verdict" value={verdictLabel(catch_.verdict)} />
            <Detail label="confidence" value={formatConfidence(catch_.confidence)} />
            <Detail label="trigger" value={catch_.trigger} />
            {catch_.modelUsed && <Detail label="model" mono value={catch_.modelUsed} />}
          </dl>
        </div>
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
