import { useCallback, useEffect, useRef, useState } from "react";

import { getJSON } from "../components";
import { copyTextWithFallback, shortId, timeAgo, type EvidenceView } from "../ui";

const INBOUND = "brain@inbound.marrowhq.com";

/**
 * Frictionless capture: drop, paste or upload raw text and it lands as
 * immutable evidence, the root of all provenance. Plus the watched-mailbox
 * address operators can copy once the email connector is configured. The view
 * only ever inserts evidence through core; the raw layer is append only, never
 * edited.
 */
export function IngestView({ readOnly }: { readOnly: boolean }): JSX.Element {
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [recent, setRecent] = useState<EvidenceView[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // the next step after a capture: what the user does now so the evidence
  // becomes facts. persists (no auto-dismiss) because it is an instruction,
  // not a transient toast.
  const [nextStep, setNextStep] = useState<{ evidenceId: string; canDistill: boolean } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inboundRef = useRef<HTMLSpanElement>(null);

  const load = useCallback(async () => {
    try {
      setRecent(await getJSON<EvidenceView[]>("/api/evidence/recent?limit=24"));
    } catch {
      // a failed list leaves the panel empty; ingesting still works.
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

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);

  const ingest = useCallback(async () => {
    if (readOnly || busy) return;
    const body = text.trim();
    if (!body) return;
    const src = source.trim() || `paste/${new Date().toISOString().slice(0, 16).replace(":", "")}`;
    setBusy(true);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: body, source: src }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setNote(e.error ?? "Could not capture that");
      } else {
        const captured = (await res.json().catch(() => ({}))) as {
          id?: string;
          canDistill?: boolean;
        };
        setText("");
        setSource("");
        setNote(`Captured · ${body.length.toLocaleString()} chars added as evidence`);
        if (captured.id) {
          setNextStep({ evidenceId: captured.id, canDistill: captured.canDistill ?? false });
        }
        await load();
      }
    } catch {
      setNote("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }, [readOnly, busy, text, source, load]);

  const readFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result ?? ""));
      setSource((s) => s || `upload/${file.name}`);
    };
    reader.readAsText(file);
  }, []);

  return (
    <div className="view view-ingest">
      <header className="view-head">
        <div>
          <h1 className="view-title">Ingest</h1>
          <p className="view-sub">
            Drop the room in. Paste a transcript, upload a file, or capture a watched inbox.
            Captured text lands as verbatim evidence, the root every fact traces back to.
          </p>
        </div>
      </header>

      <div className="ingest-grid">
        <section className="ingest-capture" aria-label="Capture">
          <div
            className={`dropzone${dragging ? " over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              if (!readOnly) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files[0];
              if (file && !readOnly) readFile(file);
            }}
          >
            <textarea
              className="ingest-text"
              placeholder="Paste a standup, an interview, a thread… or drop a .txt/.md file here"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={readOnly}
              spellCheck={false}
            />
          </div>

          <div className="ingest-controls">
            <input
              className="answer-input"
              placeholder="Source label, e.g. standups/2026-06-18.md"
              aria-label="Source label"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              disabled={readOnly}
            />
            <button
              className="btn ghost"
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={readOnly}
            >
              upload file
            </button>
            <button
              className="btn"
              onClick={() => void ingest()}
              disabled={readOnly || busy || !text.trim()}
            >
              {busy ? "capturing…" : "capture"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.markdown,text/plain"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readFile(file);
                e.target.value = "";
              }}
            />
          </div>

          {readOnly && (
            <p className="inline-note">
              read-only demo: capture is disabled, the list still reads.
            </p>
          )}
          {note && (
            <div className="inline-note live" role="status">
              {note}
            </div>
          )}

          {nextStep && (
            <div className="next-step" role="note">
              <span className="next-step-label">Next step</span>
              {nextStep.canDistill ? (
                <p>
                  Distill it into decisions, entities and questions:{" "}
                  <code>marrow distill {nextStep.evidenceId}</code>
                </p>
              ) : (
                <p>
                  Evidence is stored. To turn it into facts, set a model key (
                  <code>MARROW_API_KEY</code> for Claude or <code>MARROW_PROVIDER</code> for a local
                  LLM), then <code>marrow distill {nextStep.evidenceId}</code>. Search stays
                  semantic without a key; distillation needs one.
                </p>
              )}
            </div>
          )}

          <div className="inbound-card">
            <span className="inbound-eyebrow">Email to brain</span>
            <p className="inbound-line">
              Copy the mailbox your email connector watches:{" "}
              <button
                className="inbound-addr"
                onClick={() => {
                  setCopied(true);
                  void copyTextWithFallback(INBOUND, inboundRef.current);
                }}
                aria-label={`Copy ${INBOUND}`}
              >
                <span ref={inboundRef}>{INBOUND}</span>
                <span className="inbound-copy">{copied ? "Copied" : "Copy"}</span>
              </button>
            </p>
            <p className="inbound-sub">
              When that mailbox is connected, forwarded threads become evidence through the email
              connector and trace back to the message they came from.
            </p>
          </div>
        </section>

        <section className="ingest-recent" aria-label="Recently captured">
          <div className="section-head">
            <h2>Recently captured</h2>
            {recent.length > 0 && <span className="section-count">{recent.length}</span>}
          </div>
          {recent.length === 0 ? (
            <p className="empty">Nothing captured yet.</p>
          ) : (
            <ul className="evidence-list">
              {recent.map((e) => (
                <li key={e.id} className="evidence-row">
                  <div className="evidence-row-head">
                    <span className="evidence-source">{e.source}</span>
                    <span className="evidence-when">{timeAgo(e.createdAt)}</span>
                  </div>
                  <p className="evidence-preview">{e.preview}</p>
                  <p className="evidence-foot">
                    <span className="id">{shortId(e.id)}</span>
                    <span className="dot">·</span>
                    <span>{e.chars.toLocaleString()} chars</span>
                    <span className="dot">·</span>
                    <span>Append only</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
