"use client";

import { useSyncExternalStore } from "react";
import { CmdChip } from "@/components/ui/copy";
import { DOCS_URL, GITHUB_URL, NPM_URL } from "@/content/links";
import { getDecided, getServerDecided, subscribe } from "@/content/promote-store";

// The exit: the moat in one couplet, the biggest type on the page, both asks,
// and light under the door. The tally is live: the ceremony's promote
// re-counts it, which is why the colophon is a client component.
export function Finale() {
  const decided = useSyncExternalStore(subscribe, getDecided, getServerDecided);
  return (
    <section className="finale" aria-label="Closing">
      <p className="finale-kicker" data-reveal>
        The others remember the code. The code was never in the room.
      </p>
      <h2 className="finale-title" data-reveal>
        Put your agent in the room.
      </h2>
      <div className="finale-actions" data-reveal>
        <CmdChip command="npx @marrowhq/cli demo" />
        <a className="btn btn-ghost" href={GITHUB_URL}>
          <span className="star" aria-hidden="true">
            ★
          </span>
          Star on GitHub
        </a>
      </div>
      <div className="horizon" aria-hidden="true"></div>
      <div className="colophon">
        <p className="tally-line" id="tally">
          This page holds 7 facts: <span className="t-decided">{decided ? 2 : 1} decided</span> ·{" "}
          <span className="t-open">{decided ? 1 : 2} open</span> ·{" "}
          <span className="t-contested">2 contested</span> ·{" "}
          <span className="t-superseded">1 superseded</span> · 1 entity. Every one traced.
        </p>
        <p>
          Set in Archivo, Geist and Geist Mono, self-hosted. Built with Next.js, exported as static
          HTML. No tracking.
        </p>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <span className="footer-mark">Marrow · The room, distilled.</span>
        <nav className="footer-links" aria-label="Footer">
          <a href={GITHUB_URL}>GitHub</a>
          <a href={NPM_URL}>npm</a>
          <a href={DOCS_URL}>Docs</a>
          <a href="#faq">FAQ</a>
          <a href="/llms.txt">llms.txt</a>
        </nav>
      </div>
    </footer>
  );
}
