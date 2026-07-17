"use client";

import { useEffect, useRef, useState } from "react";
import { useReduced } from "@/components/use-reduced";
import { CiteButton } from "@/components/ui/cite";
import { CITE, spanAttr } from "@/content/citations";
import { promoteDecided } from "@/content/promote-store";

// Claim 2: the ceremony. Marrow distills the sentence and proposes a fact: it
// lands OPEN at 0.60 model. Promoting it belongs to the visitor: only a human
// promotes, never a timer, never the scroll. The promote is the page's single
// gold flash (the stamp underglow) and it fires exactly once. Without JS the
// CSS renders the finished document instead: decided, 1.00 · human.
const FACT_TITLE = "Free trial, no card upfront";

type Stage = "rest" | "proposed" | "decided";

export function Promote() {
  const reduce = useReduced();
  const sectionRef = useRef<HTMLElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const confRef = useRef<HTMLSpanElement>(null);

  const [stage, setStage] = useState<Stage>("rest");
  const [nudged, setNudged] = useState(false);
  const [aftermath, setAftermath] = useState<null | { typed: string }>(null);
  const [answerRow, setAnswerRow] = useState<"live" | "fading" | "gone">("live");
  const [live, setLive] = useState("");
  const stageRef = useRef<Stage>("rest");
  stageRef.current = stage;

  // The provenance thread aims at the line it cites; a ResizeObserver keeps
  // the aim true through font swaps and reflows.
  useEffect(() => {
    const aim = () => {
      // at 980px and below the grid stacks and CSS draws a vertical connector
      // instead (.slot::before); the horizontal thread is hidden there.
      if (window.innerWidth <= 980) return;
      const mark = markRef.current;
      const slot = slotRef.current;
      const thread = threadRef.current;
      if (!mark || !slot || !thread) return;
      const markBox = mark.getBoundingClientRect();
      const slotBox = slot.getBoundingClientRect();
      const top = markBox.top + markBox.height / 2 - slotBox.top;
      if (top > 8 && top < slotBox.height + 200) thread.style.top = `${Math.round(top)}px`;
    };
    aim();
    const ro = new ResizeObserver(aim);
    if (sectionRef.current) ro.observe(sectionRef.current);
    return () => ro.disconnect();
  }, []);

  // The proposal lifts into the margin once the sheet enters view. Reduced
  // motion lands in the end state directly.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    let t: ReturnType<typeof setTimeout>;
    const run = () => {
      if (reduce) {
        setStage("proposed");
        return;
      }
      t = setTimeout(() => setStage("proposed"), 350);
    };
    if (!("IntersectionObserver" in window)) {
      run();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && stageRef.current === "rest") {
            io.disconnect();
            run();
          }
        });
      },
      { threshold: 0.35 },
    );
    io.observe(sheet);
    return () => {
      io.disconnect();
      clearTimeout(t);
    };
  }, [reduce]);

  // The nudge: scrolled past without deciding, once, quietly.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting && stageRef.current === "proposed") {
            setNudged(true);
            io.disconnect();
          }
        });
      },
      { threshold: 0.1 },
    );
    io.observe(section);
    return () => io.disconnect();
  }, []);

  function promote() {
    // a human's decision is never dropped: even a click that lands before the
    // proposal's lift finishes still counts. only a second promote is a no-op.
    if (stageRef.current === "decided") return;
    const typed = inputRef.current?.value.trim() ?? "";
    setStage("decided");

    // the confidence ticks 0.60 -> 1.00; model flips to human. the numbers
    // are the product's real ones: a human promote stamps 1.00.
    if (reduce) {
      if (confRef.current) confRef.current.textContent = "1.00";
    } else {
      const t0 = performance.now();
      const tick = (t: number) => {
        const k = Math.min((t - t0 - 240) / 240, 1);
        if (k >= 0 && confRef.current) {
          confRef.current.textContent = (0.6 + 0.4 * Math.max(k, 0)).toFixed(2);
        }
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    // the aftermath takes the answer row's space; the typed answer is shown
    // on the page only. this is a reenactment, nothing persists.
    setNudged(false);
    setTimeout(
      () => {
        setAnswerRow("fading");
        setTimeout(
          () => {
            setAnswerRow("gone");
            setAftermath({ typed });
          },
          reduce ? 0 : 160,
        );
      },
      reduce ? 0 : 700,
    );

    // the rest of the page already knows: the slice row flips, the tally
    // re-counts, the live region announces.
    promoteDecided();
    setLive("Decided. Confidence 1.00, source human.");
  }

  const decided = stage === "decided";

  return (
    <section
      className="claim"
      id="promote"
      data-stage={stage}
      aria-label="The promote ceremony"
      ref={sectionRef}
    >
      <p className="claim-kicker" data-reveal>
        02 · The promote
      </p>
      <h2 className="claim-title" data-reveal>
        Models propose. Only a human decides.
      </h2>
      <p className="claim-support" data-reveal>
        Marrow distills the sentence into a fact. It lands open, 0.60, model. Promoting it is your
        job, and nothing on this page will do it for you. Try it.
      </p>
      <div className="promote-grid">
        <div className="sheet" ref={sheetRef}>
          <p className="sheet-head">
            EVIDENCE <span className="id">ev_3f9a</span> · interviews/design-partner.md · excerpt ·
            3 speakers · <span className="append">append only</span>
          </p>
          <ol className="doc-lines" aria-label="Interview transcript excerpt">
            <DocLine n="0006" spk="Maya:">
              Then the wall comes down.{" "}
              <mark
                id="span-decided"
                data-ev={CITE.noCard.ev}
                data-span={spanAttr(CITE.noCard)}
                ref={markRef}
              >
                Free trial, no card until they convert
              </mark>
              .
            </DocLine>
            <DocLine n="0007" spk="Partner:">
              <mark data-ev={CITE.sellsInternally.ev} data-span={spanAttr(CITE.sellsInternally)}>
                That is the version I can sell internally
              </mark>
              . Our champions can start it the day they find it.
            </DocLine>
            <DocLine n="0008" spk="Jonas:">
              What about annual billing? Finance put it on the pilot deck.
            </DocLine>
            <DocLine n="0009" spk="Maya:">
              Annual billing needs its own call with finance. Not this week.
            </DocLine>
            <DocLine n="0010" spk="Jonas:">
              Noted. Parking annual billing as open, trial scope is decided.
            </DocLine>
          </ol>
        </div>

        <aside className="margin">
          <div className="slot" ref={slotRef}>
            <div className={`fact-card${decided ? " decided just-decided" : ""}`} id="fact-card">
              <span className="stamp-underglow" aria-hidden="true"></span>
              <span className="fact-head">
                <span
                  className={`pill pill-live ${decided ? "pill-decided pill-flip" : "pill-open"}`}
                >
                  {decided ? "decided" : "open"}
                </span>
                <span className="pill pill-decided pill-final">decided</span>
                <span className="kind-tag">decision</span>
              </span>
              <p className="fact-title" id="fact-title">
                {FACT_TITLE}
              </p>
              <p className="fact-meta">
                <CiteButton cite={CITE.noCard} sep="dot" />
                <span className="fact-conf-live">
                  {" "}
                  ·{" "}
                  <span className="conf" ref={confRef}>
                    0.60
                  </span>{" "}
                  ·{" "}
                  <span className={`conf-src${decided ? " is-human" : ""}`}>
                    {decided ? "human" : "model"}
                  </span>
                </span>
                <span className="conf-final"> · 1.00 · human</span>
              </p>
              {answerRow !== "gone" && (
                <div className={`answer-row${answerRow === "fading" ? " fading" : ""}`}>
                  <input
                    type="text"
                    className="answer-input"
                    name="promote-answer"
                    aria-label="Your answer"
                    placeholder="In your words…"
                    ref={inputRef}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") promote();
                    }}
                  />
                  <button type="button" className="btn-promote" onClick={promote}>
                    Promote to decided
                  </button>
                </div>
              )}
              {nudged && stage === "proposed" && (
                <p className="nudge">Still open. Only you can decide it.</p>
              )}
              {aftermath && (
                <p className="aftermath">
                  {aftermath.typed !== "" && (
                    <span className="after-answer">
                      Answer: &quot;{aftermath.typed}&quot; · recorded in this reenactment only
                    </span>
                  )}
                  <span>
                    That was the whole loop. The model proposed, you decided.{" "}
                    <a href="#start">Run it on your room →</a>
                  </span>
                </p>
              )}
            </div>
            <div className="thread" aria-hidden="true" ref={threadRef}></div>
          </div>
          <p className="marginalia">
            One fact. One source span. One human call. The trace is the whole product.
          </p>
        </aside>
      </div>
      <p className="reenact">A reenactment of the loop, running on this page. Nothing is saved.</p>
      <div className="visually-hidden" aria-live="polite">
        {live}
      </div>
    </section>
  );
}

function DocLine({ n, spk, children }: { n: string; spk: string; children: React.ReactNode }) {
  return (
    <li className="doc-line">
      <span className="ln" aria-hidden="true">
        {n}
      </span>
      <span className="txt">
        <span className="spk">{spk}</span> {children}
      </span>
    </li>
  );
}
