import { Reveal } from "@/components/reveal";
import { CiteButton } from "@/components/ui/cite";
import { CITE, spanAttr } from "@/content/citations";
import { DEMO_URL } from "@/content/links";

// Claim 3: truth has state. Superseded is struck but never deleted,
// contested is held as tension, and the open question waits for a human in
// the live brain. The status legend here is the semantic key for the page.
export function Contested() {
  return (
    <section className="claim" id="contested" aria-label="Disagreement on the record">
      <p className="claim-kicker" data-reveal>
        03 · On the record
      </p>
      <h2 className="claim-title" data-reveal>
        Disagreement stays on the record.
      </h2>
      <p className="claim-support" data-reveal>
        Superseded is struck, never deleted. Contested holds both sides, it does not average them.
        Open waits for you, not a timer. Four statuses, and your agent can always tell which one it
        is reading.
      </p>
      <div className="promote-grid">
        <div className="sheet">
          <p className="sheet-head">
            EVIDENCE <span className="id">ev_77c1</span> · standups/2026-06-02.md · excerpt
            <span className="legend" aria-label="Status legend">
              <span className="pill pill-decided">decided</span>
              <span className="pill pill-open">open</span>
              <span className="pill pill-contested">contested</span>
              <span className="pill pill-superseded">superseded</span>
            </span>
          </p>
          <ol className="doc-lines" aria-label="Standup excerpt">
            <li className="doc-line">
              <span className="ln" aria-hidden="true">
                0003
              </span>
              <span className="txt">
                <span className="spk">Priya:</span> No-card signup shipped to staging like we
                agreed. QA started a trial this morning without a billing form in sight.
              </span>
            </li>
            {/* the evidence itself is never struck: the raw layer is immutable.
                the strike belongs to the superseded FACT in the margin. */}
            <li className="doc-line">
              <span className="ln" aria-hidden="true">
                0005
              </span>
              <span className="txt">
                <span className="spk">Priya:</span>{" "}
                <mark
                  className="m-superseded"
                  data-ev={CITE.oldPlan.ev}
                  data-span={spanAttr(CITE.oldPlan)}
                >
                  The old plan where launch needed a card wall is dead
                </mark>
                , the free trial replaced it.
              </span>
            </li>
            <li className="doc-line">
              <span className="ln" aria-hidden="true">
                0007
              </span>
              <span className="txt">
                <span className="spk">Marco:</span> The open one is trial length.{" "}
                <mark
                  className="m-contested"
                  data-ev={CITE.trialShort.ev}
                  data-span={spanAttr(CITE.trialShort)}
                >
                  I want the trial cut to 7 days
                </mark>
                , a long trial goes cold before anyone converts.
              </span>
            </li>
            <li className="doc-line">
              <span className="ln" aria-hidden="true">
                0009
              </span>
              <span className="txt">
                <span className="spk">Priya:</span>{" "}
                <mark
                  className="m-contested"
                  data-ev={CITE.trialLong.ev}
                  data-span={spanAttr(CITE.trialLong)}
                >
                  Keep the trial at 14 days
                </mark>
                . Activation takes two weekends, teams hit the aha moment on the second one.
              </span>
            </li>
            <li className="doc-line">
              <span className="ln" aria-hidden="true">
                0011
              </span>
              <span className="txt">
                <span className="spk">Marco:</span>{" "}
                <mark
                  className="m-open"
                  data-ev={CITE.notSettled.ev}
                  data-span={spanAttr(CITE.notSettled)}
                >
                  We did not settle it. Parking it for the growth review
                </mark>
                .
              </span>
            </li>
          </ol>
        </div>

        <aside className="margin">
          <Reveal className="pin-card card-superseded">
            <span className="fact-head">
              <span className="pill pill-superseded">superseded</span>
              <span className="kind-tag">decision</span>
            </span>
            <p className="pin-prompt">
              <s className="dead">Launch needs a card wall</s>
            </p>
            <p className="pin-meta">
              <CiteButton cite={CITE.oldPlan} sep="dot" /> · superseded by the free trial
            </p>
            <p className="pin-note">The fact is struck. Its evidence stays untouched.</p>
          </Reveal>
          <Reveal className="margin-note note-contested" as="p">
            Two spans disagree. Marrow holds the tension, it does not average it.
          </Reveal>
          <Reveal className="pin-card">
            <span className="fact-head">
              <span className="pill pill-open">open</span>
              <span className="kind-tag">question</span>
            </span>
            <p className="pin-prompt">
              The team split on trial length: 7 days or 14 days. Which one holds?
            </p>
            <p className="pin-meta">
              <CiteButton cite={CITE.notSettled} sep="dot" /> · 0.60 · model
            </p>
            <a className="answer-link" href={`${DEMO_URL}/#/questions`} data-demo-link>
              Your answer promotes it to decided →
            </a>
          </Reveal>
          <Reveal className="margin-note note-loop" as="p">
            This exact question is waiting in the live brain. A human answer is the only thing that
            settles it.
          </Reveal>
        </aside>
      </div>
    </section>
  );
}
