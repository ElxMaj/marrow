"use client";

import { useEffect, useRef } from "react";
import { DEMO_URL, DOCS_URL, GITHUB_URL } from "@/content/links";

// The control-room header. Full-bleed sticky bar; the hairline appears once
// the page scrolls. The star ask rides along the whole way, quiet, one click.
// On phones the links move into a native details disclosure so the page whose
// CTA is GitHub never hides GitHub.
export function Masthead() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const mast = ref.current;
    if (!mast) return;
    const onScroll = () => mast.classList.toggle("scrolled", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="masthead" ref={ref}>
      <div className="masthead-inner">
        <a className="wordmark" href="/" aria-label="Marrow home">
          <span className="wordmark-dot" aria-hidden="true"></span>
          Marrow
        </a>
        <nav className="masthead-nav" aria-label="Primary">
          <a href="#room">How it works</a>
          <a href="#run">Run it</a>
          <a href={DEMO_URL} data-demo-link>
            Live demo
          </a>
          <a href="#cloud">Cloud</a>
          <a href={DOCS_URL}>Docs</a>
          <details className="masthead-more">
            <summary>menu</summary>
            <div className="masthead-menu">
              <a href="#room">How it works</a>
              <a href="#run">Run it</a>
              <a href={DEMO_URL} data-demo-link>
                Live demo
              </a>
              <a href="#cloud">Cloud</a>
              <a href={DOCS_URL}>Docs</a>
            </div>
          </details>
          <a href={GITHUB_URL} className="nav-star">
            <span className="star" aria-hidden="true">
              ★
            </span>
            Star on GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
