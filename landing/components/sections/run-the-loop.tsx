"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReduced } from "@/components/use-reduced";
import { CiteButton } from "@/components/ui/cite";
import { DECISION_TITLE, TERM_STEPS, type TermLine } from "@/content/demo-script";
import { DEMO_URL, GITHUB_URL } from "@/content/links";

// Chapter 09: the visitor steps through the real `npx @marrowhq/cli demo`
// loop. Interactive honesty rules: only the two $ command lines type, output
// prints whole (real CLIs flush); the run stops at the question until the
// visitor promotes or explicitly leaves it open; and the decided state here
// is mono only. The serif settle and the spring belong to Exhibit A: the
// promote ceremony happens exactly once per page.
//
// Server HTML renders the finished run (the promoted path), which is the
// no-JS document. Hydration resets it to the interactive rest state.

type Path = "promoted" | "open";

type TermState = {
  /** steps fully committed to the log */
  steps: number;
  /** the visitor's call at the question step; null until they decide */
  path: Path | null;
  /** true while a step's lines are still printing */
  printing: boolean;
};

const FINISHED: TermState = { steps: 5, path: "promoted", printing: false };
const REST: TermState = { steps: 0, path: null, printing: false };

const STEP_LABELS = TERM_STEPS.map((s) => s.label);

export function RunTheLoop() {
  const reduce = useReduced();
  const [state, setState] = useState<TermState>(FINISHED);
  const [typing, setTyping] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const runToken = useRef(0);

  // With JS running, the finished document becomes an invitation instead.
  useEffect(() => {
    setHydrated(true);
    setState(REST);
  }, []);

  const cancelRun = () => {
    runToken.current += 1;
    setTyping(null);
  };

  // Commits step `n` (0-based) to the log: types the command lines, prints
  // output whole with a short stagger, then unlocks the next control.
  const runStep = useCallback(
    (n: number, path: Path | null) => {
      const token = ++runToken.current;
      const step = TERM_STEPS[n];
      if (!step) return;
      const lines = step.lines({ open: path === "open" });
      setState((s) => ({ ...s, printing: true }));

      const finish = () =>
        setState((s) => (runToken.current === token ? { steps: n + 1, path, printing: false } : s));

      if (reduce) {
        finish();
        return;
      }

      const cmd = lines.find((l) => l.kind === "cmd");
      if (cmd) {
        // type the $ line at human speed, then a working beat.
        const text = cmd.text;
        let i = 0;
        const typeNext = () => {
          if (runToken.current !== token) return;
          i += 1;
          setTyping(text.slice(0, i));
          if (i < text.length) {
            setTimeout(typeNext, 30);
          } else {
            setTimeout(() => {
              if (runToken.current !== token) return;
              setTyping(null);
              finish();
            }, 450);
          }
        };
        setTimeout(typeNext, 90);
        return;
      }
      setTimeout(() => {
        if (runToken.current === token) finish();
      }, 500);
    },
    [reduce],
  );

  const atQuestion = state.steps === 3 && state.path === null;

  const advance = useCallback(() => {
    if (state.printing || state.steps >= 5) return;
    if (atQuestion) {
      inputRef.current?.focus();
      return;
    }
    runStep(state.steps, state.path);
  }, [state, atQuestion, runStep]);

  const back = () => {
    if (state.steps === 0) return;
    cancelRun();
    const steps = state.steps - 1;
    setState({ steps, path: steps <= 3 ? null : state.path, printing: false });
  };

  const decide = (path: Path) => {
    if (state.steps !== 3 || state.path !== null) return;
    runStep(3, path);
  };

  const skip = () => {
    cancelRun();
    setState({ steps: 5, path: state.path ?? "promoted", printing: false });
  };

  const replay = () => {
    cancelRun();
    setState(REST);
  };

  // Committed log lines for the current state.
  const lines: TermLine[] = [];
  for (let i = 0; i < state.steps; i += 1) {
    const step = TERM_STEPS[i];
    if (step) lines.push(...step.lines({ open: state.path === "open" }));
  }

  return (
    <section className="run" id="run" aria-label="Run the loop">
      <p className="claim-kicker" data-reveal>
        06 · Hands on
      </p>
      <h2 className="claim-title" data-reveal>
        Run the loop right here.
      </h2>
      <p className="claim-support" data-reveal>
        A reenactment of <code className="inline-code">npx @marrowhq/cli demo</code>, the same loop
        the CLI runs on any machine with Postgres. Nothing is saved, and the run waits where the
        product waits: on you.
      </p>

      <div className="term-wrap">
        <ol className="term-rail" aria-label="Steps of the loop">
          {STEP_LABELS.map((label, i) => (
            <li key={label}>
              <button
                type="button"
                className="term-step"
                aria-current={
                  state.steps === i || (i === 4 && state.steps === 5) ? "step" : undefined
                }
                data-done={i < state.steps || undefined}
                disabled={!hydrated || i > state.steps || state.printing || (atQuestion && i > 2)}
                onClick={() => {
                  if (i < state.steps) {
                    cancelRun();
                    setState({
                      steps: i,
                      path: i <= 3 ? null : state.path,
                      printing: false,
                    });
                  } else if (i === state.steps) {
                    advance();
                  }
                }}
              >
                <span aria-hidden="true">{String(i + 1).padStart(2, "0")}</span> {label}
              </button>
            </li>
          ))}
        </ol>

        <div
          className="sheet term"
          role="group"
          aria-label="Terminal reenactment"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.target instanceof HTMLElement && e.target.tagName === "INPUT") return;
            if (e.key === "Enter" || e.key === " " || e.key === "j") {
              e.preventDefault();
              advance();
            } else if (e.key === "k" || e.key === "p") {
              e.preventDefault();
              back();
            }
          }}
        >
          <p className="sheet-head">
            <span className="console-dot" aria-hidden="true"></span>
            <span className="id">marrow demo</span> · reenactment ·{" "}
            <span className="append">nothing is saved</span>
          </p>
          <div className="term-log" role="log" ref={logRef}>
            {state.steps === 0 && !typing && (
              <p className="term-line term-hint-line">
                Press Run. You will be the human in the loop.
              </p>
            )}
            {lines.map((line, i) => (
              <TermLineView key={i} line={line} />
            ))}
            {typing !== null && (
              <p className="term-line term-cmd" aria-hidden="true">
                <span className="term-ps">$</span> {typing}
                <span className="caret" aria-hidden="true" />
              </p>
            )}
            {atQuestion && (
              <div className="term-prompt">
                <p className="term-line term-ask">
                  Promote? <strong>{DECISION_TITLE}.</strong>
                </p>
                <div className="answer-row">
                  <input
                    ref={inputRef}
                    type="text"
                    className="answer-input"
                    name="term-answer"
                    aria-label="Your answer"
                    placeholder="In your words…"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") decide("promoted");
                    }}
                  />
                  <button type="button" className="btn-promote" onClick={() => decide("promoted")}>
                    Promote to decided
                  </button>
                  <button type="button" className="btn-leave" onClick={() => decide("open")}>
                    Leave it open
                  </button>
                </div>
                <p className="nudge">Only you can decide it.</p>
              </div>
            )}
            {state.steps === 5 && (
              <p className="term-line term-end">
                The same slice you read above.{" "}
                <a href={DEMO_URL} data-demo-link>
                  Explore it live →
                </a>{" "}
                <a href={GITHUB_URL}>Star the repo →</a>{" "}
                <button type="button" className="term-replay" onClick={replay}>
                  replay
                </button>
                <span className="caret" aria-hidden="true" />
              </p>
            )}
          </div>
        </div>

        <div className="term-controls">
          <button
            type="button"
            className="btn btn-primary term-advance"
            disabled={!hydrated || state.printing || state.steps >= 5 || atQuestion}
            aria-disabled={atQuestion || undefined}
            onClick={advance}
          >
            {state.steps === 0 ? "Run" : "Next step"}
          </button>
          {atQuestion && <span className="term-gate-hint">The run waits on you, above.</span>}
          <button
            type="button"
            className="btn btn-quiet"
            disabled={!hydrated || state.steps >= 5}
            onClick={skip}
          >
            Skip to the finished run
          </button>
          <span className="term-keys" aria-hidden="true">
            enter advances · k goes back
          </span>
        </div>
      </div>
    </section>
  );
}

function TermLineView({ line }: { line: TermLine }) {
  switch (line.kind) {
    case "cmd":
      return (
        <p className="term-line term-cmd">
          <span className="term-ps">$</span> {line.text}
        </p>
      );
    case "out":
      return <p className="term-line">{line.text}</p>;
    case "fact":
      return (
        <div className="fact-row term-fact" data-state={line.status}>
          <span
            className={`f-status ${
              line.status === "decided"
                ? "st-decided"
                : line.status === "entity"
                  ? "st-entity"
                  : "st-open"
            }`}
          >
            {line.status}
          </span>
          <span className={`f-title${line.decidedFace ? " is-decided" : ""}`}>{line.title}</span>
          <span className="f-conf">{line.conf}</span>
          <CiteButton cite={line.cite} />
        </div>
      );
    case "quote":
      return (
        <p className="term-line term-quote">
          <span className="term-wash">&quot;{line.cite.text}&quot;</span> · {line.attribution}
        </p>
      );
    case "agent":
      return <p className="term-line term-agent">{line.text}</p>;
    case "tally":
      return <p className="term-line term-tally">{line.text}</p>;
  }
}
