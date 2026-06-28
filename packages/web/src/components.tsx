// Shared presentational pieces for the console. Extracted from the original
// question-loop App so every section (Questions, Graph, Observability) speaks
// one visual language: the decided-vs-open badge, the gold provenance rule, the
// serif-for-decided title, the source-trace panel. No product logic lives here.
import { useCallback, useEffect, useRef, useState } from "react";

import {
  formatConfidence,
  provenanceWeight,
  shortId,
  type Confidence,
  type Decision,
  type Entity,
  type GoalView,
  type Provenance,
  type Question,
  type Theme,
} from "./ui";

export interface TraceSpan {
  evidenceId: string;
  source: string;
  start: number;
  end: number;
  spanText: string;
}
export interface TraceResult {
  source?: string;
  spanText?: string;
  spans: TraceSpan[];
}

/** A node reduced to what the graph card and the trace panel both need. */
export interface NodeView {
  id: string;
  title: string;
  sub?: string;
  kind: "decision" | "entity" | "question" | "goal";
  status: string;
  confidence: Confidence;
  provenance: Provenance[];
}

export const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export const reduceMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return (await res.json()) as T;
}

export function decisionView(d: Decision): NodeView {
  return {
    id: d.id,
    title: d.title,
    sub: d.rationale,
    kind: "decision",
    status: d.status,
    confidence: d.confidence,
    provenance: d.provenance,
  };
}
export function entityView(e: Entity): NodeView {
  return {
    id: e.id,
    title: e.name,
    ...(e.description ? { sub: e.description } : {}),
    kind: "entity",
    status: e.status,
    confidence: e.confidence,
    provenance: e.provenance,
  };
}
export function goalView(g: GoalView): NodeView {
  return {
    id: g.id,
    title: g.title,
    ...(g.description ? { sub: g.description } : {}),
    kind: "goal",
    status: g.status,
    confidence: g.confidence,
    provenance: g.provenance,
  };
}
export function questionView(q: Question): NodeView {
  return {
    id: q.id,
    title: q.prompt,
    kind: "question",
    status: q.status,
    confidence: q.confidence,
    provenance: q.provenance,
  };
}

// traces are stable once fetched: a module-level cache shared across views so a
// node opened in Graph and again in Questions never refetches.
const traceCache = new Map<string, TraceResult>();
export async function fetchTrace(nodeId: string): Promise<TraceResult> {
  const cached = traceCache.get(nodeId);
  if (cached) return cached;
  const trace = await getJSON<TraceResult>(`/api/trace/${encodeURIComponent(nodeId)}`);
  if (traceCache.size > 60) traceCache.clear();
  traceCache.set(nodeId, trace);
  return trace;
}
export function prefetchTrace(nodeId: string): void {
  if (traceCache.has(nodeId)) return;
  void fetchTrace(nodeId).catch(() => {
    // a failed prefetch is silent; the click path will retry and report.
  });
}

/** A trace panel controller for views that browse facts (Graph, Overview). a
 *  slow cold fetch never replaces a panel the user opened later: only the most
 *  recent request is allowed to set the panel. */
export function useTrace(): {
  active: { node: NodeView; trace: TraceResult; instant: boolean } | null;
  open: (node: NodeView, instant?: boolean) => void;
  close: () => void;
} {
  const [active, setActive] = useState<{
    node: NodeView;
    trace: TraceResult;
    instant: boolean;
  } | null>(null);
  const seq = useRef(0);
  const open = useCallback((node: NodeView, instant = false) => {
    const mine = ++seq.current;
    void fetchTrace(node.id)
      .then((trace) => {
        if (seq.current === mine) setActive({ node, trace, instant });
      })
      .catch(() => {
        // a failed trace leaves the panel closed; the cue stays available.
      });
  }, []);
  const close = useCallback(() => setActive(null), []);
  return { active, open, close };
}

export function Badge({ status, stamp }: { status: string; stamp?: boolean }): JSX.Element {
  const known = ["decided", "open", "contested", "superseded"].includes(status)
    ? status
    : "superseded";
  return (
    <span className={`badge ${known}${stamp ? " stamp" : ""}`}>
      <span className="glyph" aria-hidden />
      {status}
    </span>
  );
}

/** The decided title during its settle: each word carries both faces, the
 *  working sans and the decided serif, and the serif arrives word by word. */
export function SettlingTitle({ title }: { title: string }): JSX.Element {
  const words = title.split(" ");
  return (
    <>
      <span className="visually-hidden">{title}</span>
      <span aria-hidden>
        {words.map((w, i) => {
          const text = i < words.length - 1 ? `${w} ` : w;
          return (
            <span key={i} className="word" style={{ "--i": i } as React.CSSProperties}>
              <span className="face face-sans">{text}</span>
              <span className="face face-serif">{text}</span>
            </span>
          );
        })}
      </span>
    </>
  );
}

export function NodeCard({
  view,
  promoting,
  settled,
  registerRef,
  onTrace,
  onIntent,
  lit,
}: {
  view: NodeView;
  promoting?: boolean;
  settled?: boolean;
  registerRef?: (el: HTMLElement | null) => void;
  onTrace: (instant: boolean) => void;
  onIntent: () => void;
  lit: boolean;
}): JSX.Element {
  const spans = view.provenance.length;
  const first = view.provenance[0];
  const decided = view.status === "decided";
  const settling = Boolean(promoting) && !reduceMotion();
  return (
    <button
      ref={registerRef}
      className={`node w${provenanceWeight(spans)}${promoting ? " promoting" : ""}${
        settled ? " settled" : ""
      }${lit ? " lit" : ""}`}
      data-card="node"
      onClick={(e) => onTrace(e.detail === 0)}
      onMouseEnter={onIntent}
      onFocus={onIntent}
    >
      <span className="node-head">
        <Badge status={view.status} stamp={settled ?? false} />
        <span className="kind-tag">{view.kind}</span>
      </span>
      <span className={`node-title${decided ? " is-decided" : ""}${settling ? " settling" : ""}`}>
        {settling ? <SettlingTitle title={view.title} /> : view.title}
      </span>
      {view.sub && <span className="node-sub">{view.sub}</span>}
      <span className="node-meta">
        {first && (
          <>
            <span>{shortId(first.evidenceId)}</span>
            <span className="dot">·</span>
            <span>
              [{first.start}–{first.end}]
            </span>
            <span className="dot">·</span>
          </>
        )}
        <span>{formatConfidence(view.confidence.value)}</span>
        <span className={`src ${view.confidence.source}`}>{view.confidence.source}</span>
        <span className="trace-cue">
          {spans} span{spans === 1 ? "" : "s"}
          <TraceIcon />
        </span>
      </span>
      <span className="visually-hidden">, trace to source</span>
    </button>
  );
}

export function SourcePanel({
  node,
  trace,
  instant,
  onClose,
}: {
  node: NodeView;
  trace: TraceResult;
  instant: boolean;
  onClose: () => void;
}): JSX.Element {
  const panelRef = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);

  const close = useCallback(() => {
    setClosing((already) => {
      if (already) return already;
      if (reduceMotion()) onClose();
      else setTimeout(onClose, 140);
      return true;
    });
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(".close")?.focus();

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, [tabindex]:not([tabindex="-1"])',
      );
      const firstEl = focusable[0];
      const lastEl = focusable[focusable.length - 1];
      if (!firstEl || !lastEl) return;
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [close]);

  useEffect(() => {
    if (copied === null) return;
    const t = setTimeout(() => setCopied(null), 1200);
    return () => clearTimeout(t);
  }, [copied]);

  const spans =
    trace.spans.length > 0
      ? trace.spans
      : trace.source
        ? [
            {
              evidenceId: node.provenance[0]?.evidenceId ?? "",
              source: trace.source,
              start: node.provenance[0]?.start ?? 0,
              end: node.provenance[0]?.end ?? 0,
              spanText: trace.spanText ?? "",
            },
          ]
        : [];
  const decided = node.status === "decided";
  const conf = node.confidence;
  const downOnScrim = useRef(false);

  async function copyCitation(s: TraceSpan, i: number): Promise<void> {
    try {
      await navigator.clipboard.writeText(
        `${shortId(s.evidenceId)} [${s.start}-${s.end}] ${s.source}`,
      );
      setCopied(i);
    } catch {
      // no clipboard access: user-select on the label still allows manual copy.
    }
  }

  return (
    <div
      className={`scrim${closing ? " closing" : ""}`}
      role="presentation"
      onMouseDown={(e) => {
        downOnScrim.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (downOnScrim.current && e.target === e.currentTarget) close();
      }}
    >
      <aside
        ref={panelRef}
        className={`source-panel${instant ? " instant" : ""}${closing ? " closing" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Source for: ${node.title}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-head">
          <div className="panel-fact">
            <span className="panel-eyebrow">
              {node.kind} · {node.status}
            </span>
            <span className={`panel-title${decided ? " is-decided" : ""}`}>{node.title}</span>
          </div>
          <button className="close" onClick={close} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="panel-conf">
          <span>Confidence</span>
          <span className="conf-value">{formatConfidence(conf.value)}</span>
          <span className={`src ${conf.source}`}>{conf.source}</span>
          <span className="conf-standing">
            {conf.source === "human" ? "A human stands behind this" : "A model proposed this"}
          </span>
        </div>

        {spans.length === 0 ? (
          <p className="panel-empty">No evidence span recorded.</p>
        ) : (
          spans.map((s, i) => (
            <div
              key={`${s.evidenceId}-${i}`}
              className="evidence"
              style={{ "--i": i } as React.CSSProperties}
            >
              <p className="evidence-label">
                EVIDENCE <span className="id">{shortId(s.evidenceId)}</span> · [{s.start}–{s.end}]
                <button
                  className="copy-cite"
                  onClick={() => void copyCitation(s, i)}
                  aria-label="Copy citation"
                >
                  {copied === i ? "Copied" : "Copy"}
                </button>
              </p>
              <blockquote className="span">
                <mark className="hl">{s.spanText}</mark>
                <cite>{s.source} · Verbatim, append only</cite>
              </blockquote>
            </div>
          ))
        )}
      </aside>
    </div>
  );
}

export function Skeleton({ rows }: { rows: number }): JSX.Element {
  return (
    <ul className="cards" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="card skeleton" />
      ))}
    </ul>
  );
}

/** A count that ticks to its new value instead of snapping. */
export function Ticking({ value, className }: { value: number; className?: string }): JSX.Element {
  const [shown, setShown] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value || reduceMotion()) {
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number): void => {
      const k = Math.min((t - t0) / 200, 1);
      setShown(Math.round(from + (value - from) * k));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={className}>{shown}</span>;
}

export function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: Theme;
  onToggle: () => void;
}): JSX.Element {
  const toLight = theme === "dark";
  return (
    <button
      className="theme-toggle"
      onClick={onToggle}
      aria-label={toLight ? "switch to light" : "switch to dark"}
      title={toLight ? "switch to light" : "switch to dark"}
    >
      {toLight ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

export function SunIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <circle cx="12" cy="12" r="4.2" />
      <path
        strokeLinecap="round"
        d="M12 3v2.2M12 18.8V21M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M3 12h2.2M18.8 12H21M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"
      />
    </svg>
  );
}
export function MoonIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path strokeLinejoin="round" d="M20 14.2A8 8 0 1 1 9.8 4 6.4 6.4 0 0 0 20 14.2Z" />
    </svg>
  );
}
export function CloseIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 14 14"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M3.5 3.5 10.5 10.5M10.5 3.5 3.5 10.5" />
    </svg>
  );
}
export function TraceIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 12 12"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3.5 8.5 8.5 3.5" />
      <path d="M4.6 3.5H8.5V7.4" />
    </svg>
  );
}
