"use client";

import { useSyncExternalStore } from "react";
import { CiteButton, CiteDemoLink } from "@/components/ui/cite";
import { CITE } from "@/content/citations";
import { DEMO_URL } from "@/content/links";
import { getDecided, getServerDecided, subscribe } from "@/content/promote-store";

// Claim 4: the payoff. What the agent reads is the slice for the task, with
// status and citation on every fact; the first row belongs to the ceremony
// above, and when the visitor promotes there this slice already knows. The
// token meter keeps the efficiency claim honest: synthetic numbers, footnoted.
export function Slice() {
  const decided = useSyncExternalStore(subscribe, getDecided, getServerDecided);

  return (
    <section className="claim" id="slice" aria-label="What the agent reads">
      <p className="claim-kicker" data-reveal>
        04 · The slice
      </p>
      <h2 className="claim-title" data-reveal>
        Your agent gets the slice, not the archive.
      </h2>
      <p className="claim-support" data-reveal>
        prepare_task returns the facts that matter for this task, each with status, confidence and
        source span. Never the whole brain, never a raw dump.
      </p>
      <div className="slice-grid">
        <div className="sheet slice" data-reveal>
          <p className="sheet-head">
            MCP · <span className="id">prepare_task</span>({"{"} task: &quot;require a card at
            signup&quot; {"}"}) → 4 facts
          </p>
          <div className="fact-rows">
            <div className="fact-row" data-state={decided ? "decided" : "open"}>
              <span className={`f-status ${decided ? "st-decided" : "st-open"}`}>
                {decided ? "decided" : "open"}
              </span>
              <span className="f-title">Free trial, no card upfront</span>
              <span className="f-conf">{decided ? "1.00 human" : "0.60 model"}</span>
              <CiteButton cite={CITE.noCard} />
              <span className="f-note">
                {decided ? "· You decided this, just now" : "· Waiting on you, above"}
              </span>
            </div>
            <div className="fact-row">
              <span className="f-status st-decided">decided</span>
              <span className="f-title">Pricing is per workspace, flat</span>
              <span className="f-conf">1.00 human</span>
              <CiteDemoLink cite={CITE.pricing} />
            </div>
            <div className="fact-row">
              <span className="f-status st-open">open</span>
              <span className="f-title">Trial length: 7 days or 14 days</span>
              <span className="f-conf">0.60 model</span>
              <CiteButton cite={CITE.notSettled} />
            </div>
            <div className="fact-row">
              <span className="f-status st-entity">entity</span>
              <span className="f-title">Annual billing</span>
              <span className="f-conf">0.85 model</span>
              <CiteDemoLink cite={CITE.annualBilling} />
            </div>
          </div>
          <p className="agent-line">
            <span className="sigil" aria-hidden="true">
              agent&gt;
            </span>{" "}
            trial length is still open (ev_77c1), asking before building.
          </p>
        </div>
        <div className="sheet token-meter" data-reveal>
          <p className="sheet-head">
            CONTEXT SIZE · <span className="id">same task, two ways</span>
          </p>
          <div className="meter-body">
            <div className="meter-row">
              <p className="meter-label">
                <span>raw dump of the room</span>
                <span className="n">473 tokens</span>
              </p>
              <div className="meter-bar">
                <span className="meter-fill" style={{ "--fill": 1 } as React.CSSProperties}></span>
              </div>
            </div>
            <div className="meter-row">
              <p className="meter-label">
                <span>the Marrow slice</span>
                <span className="n">190 tokens</span>
              </p>
              <div className="meter-bar">
                <span
                  className="meter-fill gold"
                  style={{ "--fill": 0.402 } as React.CSSProperties}
                ></span>
              </div>
            </div>
            <p className="meter-verdict">2.5x fewer tokens, every fact still traced.*</p>
            <p className="fn">
              * Synthetic fixture benchmark: 3 docs, 3 task questions, chars/4 heuristic; raw 473
              tokens, Marrow average 190, 3.85 ms retrieval. No partner-data claim yet.
            </p>
          </div>
        </div>
      </div>
      <p className="slice-caption">
        The agent sees what is decided now and what is still open, and Marrow raises a question when
        code drifts from a decided fact instead of letting the two quietly diverge.{" "}
        <a href={DEMO_URL} data-demo-link>
          The same brain, live →
        </a>
      </p>
    </section>
  );
}
