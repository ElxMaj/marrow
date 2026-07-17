"use client";

import { useRef, type ReactNode } from "react";

// A command you can paste beats a get-started. The label crossfades to
// "Copied" for 1.2s, opacity only, then back.
function useCopy() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (el: HTMLElement, text: string) => {
    const done = () => {
      el.classList.add("copied");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => el.classList.remove("copied"), 1200);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      done();
    }
  };
}

export function CmdChip({ command }: { command: string }) {
  const copy = useCopy();
  return (
    <button type="button" className="cmd-chip" onClick={(e) => copy(e.currentTarget, command)}>
      <span className="cmd-text">{command}</span>
      <span className="cmd-copied" aria-hidden="true">
        Copied
      </span>
    </button>
  );
}

export function IntakeLine({ command, children }: { command: string; children: ReactNode }) {
  const copy = useCopy();
  return (
    <button type="button" className="intake-line" onClick={(e) => copy(e.currentTarget, command)}>
      <span className="c">
        {children}{" "}
        <span className="copied-note" aria-hidden="true">
          Copied
        </span>
      </span>
      <span className="cmd">{renderCommand(command)}</span>
    </button>
  );
}

// The leading binary gets the accent, matching the old page's grammar.
function renderCommand(command: string) {
  const space = command.indexOf(" ");
  if (space === -1) return command;
  return (
    <>
      <span className="p">{command.slice(0, space)}</span>
      {command.slice(space)}
    </>
  );
}
