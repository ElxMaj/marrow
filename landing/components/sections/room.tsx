"use client";

import { useEffect, useRef, useState } from "react";
import { CITE, spanAttr } from "@/content/citations";

// Claim 1: the room. The evidence ledger prints the real seed documents in
// append-only order, and the scanline reads the first excerpt once when it
// enters view: gold light passing over raw text, leaving the salient span
// lit. Without JS the marks are simply lit; the document is finished.
const LEDGER = [
  { src: "interviews/design-partner.md", ev: "ev_3f9a" },
  { src: "standups/2026-06-02.md", ev: "ev_77c1" },
  { src: "notes/pricing-call-2026-05-28.md", ev: "ev_9b2e" },
  { src: "interviews/design-review.md", ev: "ev_41c2" },
];

export function Room() {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    if (!("IntersectionObserver" in window)) {
      setScanned(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setScanned(true);
            io.disconnect();
          }
        });
      },
      { threshold: 0.4 },
    );
    io.observe(sheet);
    return () => io.disconnect();
  }, []);

  return (
    <section className="claim" id="room" aria-label="The room">
      <p className="claim-kicker" data-reveal>
        01 · The room
      </p>
      <h2 className="claim-title" data-reveal>
        Your product is decided in meetings, not in the repo.
      </h2>
      <p className="claim-support" data-reveal>
        Trial scope moves on a partner call. Pricing settles in a notes doc. Trial length is still
        being argued in a standup. None of it reaches the agent. Marrow ingests the raw room
        verbatim, as immutable evidence: rows are only ever appended, never edited, so every fact
        built on them keeps its footing.
      </p>
      <div className="room-grid">
        <div className="sheet room-ledger" data-reveal>
          <p className="sheet-head">
            EVIDENCE LOG · <span className="id">append only</span>
          </p>
          <div>
            {LEDGER.map((row) => (
              <p className="ledger-line" key={row.ev}>
                <span className="src">{row.src}</span>
                <span className="arrow" aria-hidden="true">
                  →
                </span>
                <span className="ev">{row.ev}</span>
                <span className="stamp-ao">insert only</span>
              </p>
            ))}
          </div>
        </div>
        {/* no data-reveal here: React re-renders this className when `scanned`
            flips, which would wipe the imperative .revealed class. the
            scanline IS this sheet's entrance. */}
        <div className={`sheet room-sheet${scanned ? " scanned" : ""}`} ref={sheetRef}>
          <span className="scanline" aria-hidden="true"></span>
          <p className="sheet-head">
            EVIDENCE <span className="id">ev_3f9a</span> · interviews/design-partner.md · excerpt
          </p>
          <ol className="doc-lines" aria-label="Interview transcript excerpt">
            <li className="doc-line">
              <span className="ln" aria-hidden="true">
                0003
              </span>
              <span className="txt">
                <span className="spk">Maya:</span> Launch is Monday. The trial is the last call we
                have not made.
              </span>
            </li>
            <li className="doc-line">
              <span className="ln" aria-hidden="true">
                0004
              </span>
              <span className="txt">
                <span className="spk">Partner:</span> We ran a card wall last quarter. Signups
                dropped forty percent overnight, and the ones who stayed churned anyway.
              </span>
            </li>
            <li className="doc-line">
              <span className="ln" aria-hidden="true">
                0005
              </span>
              <span className="txt">
                <span className="spk">Jonas:</span> And{" "}
                <mark data-ev={CITE.cardForm.ev} data-span={spanAttr(CITE.cardForm)}>
                  every support ticket in week one was the card form
                </mark>
                . We cannot spend launch week on billing edge cases.
              </span>
            </li>
          </ol>
        </div>
      </div>
    </section>
  );
}
