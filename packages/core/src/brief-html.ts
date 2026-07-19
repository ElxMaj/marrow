import type { BriefNode, TruthMaintenanceBrief } from "./marrow.js";

// R22: the daily brief becomes the morning read. `marrow truth` already returns
// the maintenance brief as data; this renders it as a self-contained HTML
// artifact a cron job can write to a file or drop into an email. It is the same
// truth the console shows, in the same black-room language, so the morning read
// and the console never disagree.
//
// Self-contained on purpose: one inline <style>, system font stacks, no external
// asset, no script. That makes it safe to email and safe to open from disk. The
// palette mirrors packages/web/src/styles.css token for token, including the
// light-theme override, so the artifact adapts to the reader's morning. Gold
// stays action only: it marks the one "what needs you" block and the console
// link, never a status. Status always carries a glyph and a label, never colour
// alone.

/** Escape the five characters that would otherwise break out of HTML text or an
 *  attribute. Every dynamic string (a title, a source, a verbatim span, an
 *  error) passes through this before it reaches the document. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A coarse "3 days ago" from an ISO timestamp. `nowMs` is injected so the
 *  render is deterministic under test; the CLI passes Date.now(). */
export function relativeTime(iso: string, nowMs: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const s = Math.max(0, Math.round((nowMs - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

/** How a status paints in the brief: a glyph so it survives a colour-blind read
 *  or a stripped stylesheet, a word, and which hue token to use. Gold is absent
 *  on purpose; it is action, never status. */
const STATUS_META: Record<string, { glyph: string; label: string; hue: string }> = {
  decided: { glyph: "●", label: "decided", hue: "--decided" },
  open: { glyph: "○", label: "open", hue: "--open" },
  contested: { glyph: "◑", label: "contested", hue: "--contested" },
  superseded: { glyph: "—", label: "superseded", hue: "--superseded" },
  dismissed: { glyph: "—", label: "dismissed", hue: "--superseded" },
  retracted: { glyph: "—", label: "retracted", hue: "--superseded" },
};

function statusChip(status: string): string {
  const meta = STATUS_META[status] ?? { glyph: "•", label: status, hue: "--ink-faint" };
  return `<span class="chip" style="color:var(${meta.hue})"><span class="glyph" aria-hidden="true">${meta.glyph}</span>${escapeHtml(meta.label)}</span>`;
}

/** One fact: its status chip, kind and title in the title voice, a stale badge
 *  when the brief flagged it, and the first verbatim provenance span in the mono
 *  evidence voice. No provenance means the fact is not shown as a claim. */
function factRow(node: BriefNode, nowMs: number): string {
  const span = node.provenance?.[0];
  const stale = node.stale ? ` <span class="stale">stale, reverify</span>` : "";
  const evidence = span
    ? `<div class="evidence"><span class="src">${escapeHtml(span.source)}${
        span.createdAt ? ` · ${escapeHtml(relativeTime(span.createdAt, nowMs))}` : ""
      }</span><span class="quote">${escapeHtml(span.spanText)}</span></div>`
    : "";
  return `<li class="fact">
    <div class="fact-head">${statusChip(node.status)}<span class="kind">${escapeHtml(node.kind)}</span><span class="title">${escapeHtml(node.title)}</span>${stale}</div>
    ${evidence}
  </li>`;
}

function section(title: string, nodes: BriefNode[], nowMs: number): string {
  const body =
    nodes.length === 0
      ? `<p class="empty">Nothing here.</p>`
      : `<ul class="facts">${nodes.map((n) => factRow(n, nowMs)).join("")}</ul>`;
  return `<section class="block"><h2>${escapeHtml(title)} <span class="count">${nodes.length}</span></h2>${body}</section>`;
}

/** Options for the render. `now`/`generatedAt` are injected for a deterministic
 *  document; `consoleUrl` turns the footer into the one action link. */
export interface TruthHtmlOptions {
  now?: number;
  generatedAt?: string;
  consoleUrl?: string;
  title?: string;
}

/**
 * Render the maintenance brief as a complete HTML document string. Pure: give it
 * the same brief and options and it returns byte-identical HTML.
 */
export function renderTruthHtml(brief: TruthMaintenanceBrief, opts: TruthHtmlOptions = {}): string {
  const nowMs = opts.now ?? 0;
  const generated = opts.generatedAt ?? "";
  const docTitle = opts.title ?? "The room, this morning";

  const decidedCount =
    brief.sourceOfTruth.decidedGoals.length + brief.sourceOfTruth.decidedDecisions.length;
  const waiting =
    brief.openProposedGoals.length +
    brief.contestedFacts.length +
    brief.gapQuestions.length +
    brief.pendingCatches.length;

  const actions =
    brief.nextActions.length === 0
      ? `<p class="settled">Nothing waiting. The room is settled.</p>`
      : `<ul class="actions">${brief.nextActions.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul>`;

  const catches =
    brief.pendingCatches.length === 0
      ? `<p class="empty">Nothing here.</p>`
      : `<ul class="facts">${brief.pendingCatches
          .map(
            (c) =>
              `<li class="fact"><div class="fact-head"><span class="kind">drift</span><span class="title">${escapeHtml(
                c.decisionTitle,
              )}</span></div><div class="evidence"><span class="src">${escapeHtml(
                c.path ?? "unknown",
              )}:${c.lineStart ?? "?"}-${c.lineEnd ?? "?"}</span></div></li>`,
          )
          .join("")}</ul>`;

  const connectors =
    brief.connectorHealth.length === 0
      ? `<p class="empty">No connectors configured.</p>`
      : `<ul class="connectors">${brief.connectorHealth
          .map((c) => {
            const bad = c.status === "error" || c.status === "stale";
            return `<li><span class="chip" style="color:var(${
              bad ? "--contested" : c.status === "ok" ? "--decided" : "--ink-faint"
            })"><span class="glyph" aria-hidden="true">${
              bad ? "◑" : c.status === "ok" ? "●" : "—"
            }</span>${escapeHtml(c.status)}</span><span class="cname">${escapeHtml(
              c.name,
            )}</span><span class="ckind">${escapeHtml(c.kind)}</span>${
              c.lastError ? `<span class="cerr">${escapeHtml(c.lastError)}</span>` : ""
            }</li>`;
          })
          .join("")}</ul>`;

  const footer = opts.consoleUrl
    ? `<a class="cta" href="${escapeHtml(opts.consoleUrl)}">Open the room →</a>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${escapeHtml(docTitle)}</title>
<style>
  :root {
    --paper:#08090b; --surface:#0e1013; --surface-2:#13161a;
    --line:#1e2227; --line-strong:#2c313a;
    --ink:#e8e6e1; --ink-muted:#a3a19a; --ink-faint:#85837c;
    --gold:#d8a657; --accent-ink:#1a1206;
    --decided:#8bb88a; --open:#e3a24a; --contested:#d98a73; --superseded:#8b897f;
    --font-title:"Archivo",system-ui,-apple-system,"Segoe UI",sans-serif;
    --font-ui:"Geist",system-ui,-apple-system,"Segoe UI",sans-serif;
    --font-mono:ui-monospace,"Geist Mono",SFMono-Regular,Menlo,monospace;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --paper:#f4efe4; --surface:#fbf7ee; --surface-2:#fffdf8;
      --line:#e2dacb; --line-strong:#d2c9b6;
      --ink:#2a2620; --ink-muted:#6f685c; --ink-faint:#736b5d;
      --gold:#b0822e; --accent-ink:#fbf7ee;
      --decided:#3f6b43; --open:#8a6420; --contested:#9c4a33; --superseded:#6b645a;
    }
  }
  * { box-sizing:border-box; }
  body {
    margin:0; padding:32px 20px; background:var(--paper); color:var(--ink);
    font-family:var(--font-ui); font-size:15px; line-height:1.5;
    -webkit-font-smoothing:antialiased;
  }
  .wrap { max-width:680px; margin:0 auto; }
  .masthead { border-bottom:1px solid var(--line-strong); padding-bottom:20px; margin-bottom:8px; }
  .masthead h1 { font-family:var(--font-title); font-size:30px; font-weight:640; letter-spacing:-0.01em; margin:0 0 6px; }
  .stamp { font-family:var(--font-mono); font-size:12px; color:var(--ink-faint); }
  .stamp b { color:var(--decided); font-weight:600; }
  .needs { border-left:2px solid var(--gold); padding:14px 0 14px 16px; margin:24px 0; }
  .needs h2 { font-family:var(--font-title); font-size:13px; text-transform:uppercase; letter-spacing:0.08em; color:var(--gold); margin:0 0 8px; }
  .actions { margin:0; padding-left:18px; }
  .actions li { margin:3px 0; }
  .settled { margin:0; color:var(--ink-muted); }
  .block { margin:24px 0; }
  .block h2 { font-family:var(--font-title); font-size:13px; text-transform:uppercase; letter-spacing:0.08em; color:var(--ink-muted); margin:0 0 10px; padding-bottom:8px; border-bottom:1px solid var(--line); }
  .count { font-family:var(--font-mono); color:var(--ink-faint); font-weight:400; }
  .facts, .connectors { list-style:none; margin:0; padding:0; }
  .fact { padding:10px 0; border-bottom:1px solid var(--line); }
  .fact:last-child { border-bottom:0; }
  .fact-head { display:flex; flex-wrap:wrap; align-items:baseline; gap:8px; }
  .chip { font-family:var(--font-mono); font-size:12px; display:inline-flex; align-items:baseline; gap:5px; }
  .glyph { font-size:10px; }
  .kind { font-family:var(--font-mono); font-size:12px; color:var(--ink-faint); }
  .title { font-family:var(--font-title); font-size:15px; color:var(--ink); }
  .stale { font-family:var(--font-mono); font-size:11px; color:var(--open); }
  .evidence { margin:6px 0 0 0; padding-left:14px; border-left:1px solid var(--line-strong); }
  .src { display:block; font-family:var(--font-mono); font-size:11px; color:var(--ink-faint); margin-bottom:2px; }
  .quote { display:block; font-family:var(--font-mono); font-size:12px; color:var(--ink-muted); }
  .empty { margin:0; color:var(--ink-faint); font-size:13px; }
  .connectors li { display:flex; flex-wrap:wrap; align-items:baseline; gap:8px; padding:7px 0; border-bottom:1px solid var(--line); }
  .connectors li:last-child { border-bottom:0; }
  .cname { color:var(--ink); }
  .ckind { font-family:var(--font-mono); font-size:12px; color:var(--ink-faint); }
  .cerr { font-family:var(--font-mono); font-size:11px; color:var(--contested); width:100%; }
  .foot { margin-top:32px; padding-top:20px; border-top:1px solid var(--line-strong); }
  .cta { color:var(--gold); text-decoration:none; font-weight:600; }
  .cta:hover { text-decoration:underline; }
</style>
</head>
<body>
<div class="wrap">
  <header class="masthead">
    <h1>${escapeHtml(docTitle)}</h1>
    <p class="stamp"><b>${decidedCount}</b> decided · ${waiting} waiting on you${
      generated ? ` · ${escapeHtml(generated)}` : ""
    }</p>
  </header>

  <div class="needs">
    <h2>What needs you</h2>
    ${actions}
  </div>

  ${section("Decided goals", brief.sourceOfTruth.decidedGoals, nowMs)}
  ${section("Decided decisions", brief.sourceOfTruth.decidedDecisions, nowMs)}
  ${section("Open proposed goals", brief.openProposedGoals, nowMs)}
  ${section("Contested facts", brief.contestedFacts, nowMs)}
  ${section("Gap questions", brief.gapQuestions, nowMs)}

  <section class="block"><h2>Pending catches <span class="count">${brief.pendingCatches.length}</span></h2>${catches}</section>
  <section class="block"><h2>Connector health <span class="count">${brief.connectorHealth.length}</span></h2>${connectors}</section>

  <footer class="foot">${footer}</footer>
</div>
</body>
</html>`;
}
