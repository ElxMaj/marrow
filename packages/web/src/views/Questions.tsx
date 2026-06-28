import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import {
  decisionView,
  entityView,
  fetchTrace,
  NodeCard,
  prefetchTrace,
  questionView,
  reduceMotion,
  Skeleton,
  SourcePanel,
  TraceIcon,
  delay,
  type NodeView,
  type TraceResult,
} from "../components";
import {
  formatConfidence,
  sandboxPromote,
  shortId,
  type Decision,
  type Question,
  type SandboxState,
} from "../ui";

export type BrainState = SandboxState & { readOnly: boolean };

export type QuestionKeyboardCardKind = "question" | "node";

export type QuestionKeyboardAction =
  | { action: "none" }
  | { action: "focus-card"; index: number }
  | { action: "focus-first-answer" }
  | { action: "focus-active-answer" }
  | { action: "trace-active-node" };

export function questionKeyboardIntent({
  key,
  metaKey = false,
  ctrlKey = false,
  altKey = false,
  typing = false,
  sourcePanelOpen = false,
  activeCardKind,
  cardCount,
  currentIndex,
}: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  typing?: boolean;
  sourcePanelOpen?: boolean;
  activeCardKind?: QuestionKeyboardCardKind | undefined;
  cardCount: number;
  currentIndex: number;
}): QuestionKeyboardAction {
  if (metaKey || ctrlKey || altKey || typing || sourcePanelOpen) return { action: "none" };
  if (key === "j" || key === "k") {
    if (cardCount === 0) return { action: "none" };
    const next =
      key === "j" ? Math.min(currentIndex + 1, cardCount - 1) : Math.max(currentIndex - 1, 0);
    return { action: "focus-card", index: next };
  }
  if (key === "/") return { action: "focus-first-answer" };
  if (key === "Enter" && activeCardKind === "question") return { action: "focus-active-answer" };
  if (key === "t" && activeCardKind === "node") return { action: "trace-active-node" };
  return { action: "none" };
}

export type QuestionInputKeyIntent = "answer" | "blur" | "none";

export function questionInputKeyIntent(key: string): QuestionInputKeyIntent {
  if (key === "Enter") return "answer";
  if (key === "Escape") return "blur";
  return "none";
}

export function shouldRunPromoteTravel({
  hasFromRect,
  reduceMotion,
  viewportWidth,
}: {
  hasFromRect: boolean;
  reduceMotion: boolean;
  viewportWidth: number;
}): boolean {
  return hasFromRect && !reduceMotion && viewportWidth > 820;
}

export function promoteLeaveDelayMs(reduce: boolean): number {
  return reduce ? 0 : 360;
}

export function promoteSettleDelayMs(reduce: boolean): number {
  return reduce ? 0 : 1100;
}

export function promoteToastMessage({
  promotedCount,
  readOnly,
}: {
  promotedCount: number;
  readOnly: boolean;
}): string {
  if (promotedCount > 0) {
    return readOnly ? "Decided · sandbox, nothing saved" : "Decided · traced to your answer";
  }
  return readOnly ? "Answered · sandbox, nothing saved" : "Answered · recorded as evidence";
}

export async function runPromoteTravel({
  nodeId,
  from,
  cards,
  body,
  reduceMotion,
  viewportWidth,
  waitForFrame = () =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    ),
}: {
  nodeId: string;
  from: DOMRect | undefined;
  cards: Map<string, HTMLElement>;
  body: { appendChild(node: Node): Node };
  reduceMotion: boolean;
  viewportWidth: number;
  waitForFrame?: () => Promise<void>;
}): Promise<void> {
  if (
    !shouldRunPromoteTravel({
      hasFromRect: Boolean(from),
      reduceMotion,
      viewportWidth,
    })
  ) {
    return;
  }
  if (!from) return;
  await waitForFrame();
  const el = cards.get(nodeId);
  if (!el || typeof el.animate !== "function") return;
  const to = el.getBoundingClientRect();
  if (to.width === 0) return;

  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${to.left}px`,
    top: `${to.top}px`,
    width: `${to.width}px`,
    height: `${to.height}px`,
    margin: "0",
    zIndex: "30",
    pointerEvents: "none",
  });
  body.appendChild(ghost);
  el.style.opacity = "0";
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  try {
    await ghost.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)`, opacity: 0.4 },
        { transform: "translate(0, 0)", opacity: 1 },
      ],
      { duration: 420, easing: "cubic-bezier(0.77, 0, 0.175, 1)" },
    ).finished;
  } catch {
    // an interrupted travel still lands: the real card is revealed below.
  }
  ghost.remove();
  el.style.opacity = "";
}

export function glidePromoteSiblings({
  before,
  cards,
  skip,
  reduceMotion,
}: {
  before: Map<string, DOMRect>;
  cards: Map<string, HTMLElement>;
  skip: Set<string>;
  reduceMotion: boolean;
}): void {
  if (reduceMotion) return;
  for (const [id, el] of cards) {
    if (skip.has(id) || typeof el.animate !== "function") continue;
    const old = before.get(id);
    if (!old) continue;
    const now = el.getBoundingClientRect();
    const dy = old.top - now.top;
    if (Math.abs(dy) < 2) continue;
    el.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], {
      duration: 240,
      easing: "cubic-bezier(0.23, 1, 0.32, 1)",
    });
  }
}

/**
 * The question loop, intact: the inbox of open questions the room left, the
 * distilled graph beside it, and the one rationed celebratory beat when an
 * Answer promotes a node to decided (the card travels across, the neighbours
 * glide, the type settles sans to serif, the toast closes the sentence). This
 * is the original App body, now mounted as the console's Questions section.
 * Zero product logic: answering goes through core.answer over /api/answer.
 */
export function QuestionsView({
  state,
  setState,
  status,
  refresh,
}: {
  state: BrainState;
  setState: Dispatch<SetStateAction<BrainState>>;
  status: "loading" | "ready" | "error";
  refresh: () => Promise<void>;
}): JSX.Element {
  const [active, setActive] = useState<{
    node: NodeView;
    trace: TraceResult;
    instant: boolean;
  } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [promoting, setPromoting] = useState<Set<string>>(new Set());
  const [settled, setSettled] = useState<Set<string>>(new Set());
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toastIn, setToastIn] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [batchDraft, setBatchDraft] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);

  // every card registers here so the promote travel can measure real rects.
  const cardEls = useRef<Map<string, HTMLElement>>(new Map());
  const registerCard = useCallback((id: string) => {
    return (el: HTMLElement | null) => {
      if (el) cardEls.current.set(id, el);
      else cardEls.current.delete(id);
    };
  }, []);

  const showToast = useCallback((msg: string) => setToastMsg(msg), []);
  // drive the toast in, then out, then unmount — symmetric, once, no loop.
  useEffect(() => {
    if (!toastMsg) return;
    const enter = requestAnimationFrame(() => setToastIn(true));
    const exit = setTimeout(() => setToastIn(false), 2600);
    const clear = setTimeout(() => setToastMsg(null), 2820);
    return () => {
      cancelAnimationFrame(enter);
      clearTimeout(exit);
      clearTimeout(clear);
    };
  }, [toastMsg]);

  // a slow cold fetch must not replace a panel the user opened later: only
  // the most recent request is allowed to set the panel.
  const traceSeq = useRef(0);
  const showSource = useCallback(async (node: NodeView, instant = false) => {
    const seq = ++traceSeq.current;
    try {
      const trace = await fetchTrace(node.id);
      if (traceSeq.current !== seq) return;
      setActive({ node, trace, instant });
    } catch {
      if (traceSeq.current === seq) setToastMsg("Could not load the source");
    }
  }, []);

  // a question's related decisions, resolved from state. more than one means a
  // conflict: the human must pick which holds before answering.
  const relatedDecisions = useCallback(
    (q: Question): Decision[] => {
      const ids = new Set(q.relatesTo ?? []);
      return state.decisions.filter((d) => ids.has(d.id));
    },
    [state.decisions],
  );

  /**
   * The promote travel: the answered question's card visibly becomes the
   * decided card. a fixed-position clone animates from where the question sat
   * to where the decided node landed, then the settle runs on the real card.
   */
  const travel = useCallback(async (nodeId: string, from: DOMRect | undefined): Promise<void> => {
    await runPromoteTravel({
      nodeId,
      from,
      cards: cardEls.current,
      body: document.body,
      reduceMotion: reduceMotion(),
      viewportWidth: window.innerWidth,
    });
  }, []);

  /** FLIP the displaced neighbours so the promote reads as one continuous motion. */
  const glideSiblings = useCallback((before: Map<string, DOMRect>, skip: Set<string>) => {
    glidePromoteSiblings({
      before,
      cards: cardEls.current,
      skip,
      reduceMotion: reduceMotion(),
    });
  }, []);

  const answer = useCallback(
    async (q: Question) => {
      if (busy) return;
      const text = (drafts[q.id] ?? "").trim();
      if (!text) return;
      const conflict = relatedDecisions(q);
      const decide = conflict.length > 1 ? choices[q.id] : undefined;
      if (conflict.length > 1 && !decide) {
        setErrors((e) => ({ ...e, [q.id]: "Pick which decision holds" }));
        return;
      }
      setBusy(q.id);
      setErrors((e) => ({ ...e, [q.id]: "" }));
      const fromRect = cardEls.current.get(q.id)?.getBoundingClientRect();
      const reduce = reduceMotion();

      let promotedIds: string[] = [];
      let nextState: BrainState | null = null;
      if (state.readOnly) {
        const result = sandboxPromote(state, q.id, text, decide);
        if (!result) {
          setErrors((e) => ({ ...e, [q.id]: "Could not record the answer" }));
          setBusy(null);
          return;
        }
        promotedIds = result.promotedIds;
        nextState = result.state as BrainState;
      } else {
        try {
          const res = await fetch("/api/answer", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ questionId: q.id, text, ...(decide ? { decide } : {}) }),
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            setErrors((e) => ({ ...e, [q.id]: body.error ?? "Could not record the answer" }));
            setBusy(null);
            return;
          }
          const data = (await res.json().catch(() => ({}))) as { promoted?: { id: string }[] };
          promotedIds = (data.promoted ?? []).map((p) => p.id);
        } catch {
          setErrors((e) => ({ ...e, [q.id]: "Could not reach the server" }));
          setBusy(null);
          return;
        }
      }

      setDrafts((d) => ({ ...d, [q.id]: "" }));

      const beforeRects = new Map<string, DOMRect>();
      for (const [id, el] of cardEls.current) beforeRects.set(id, el.getBoundingClientRect());
      setLeaving((s) => new Set(s).add(q.id));
      await delay(promoteLeaveDelayMs(reduce));
      if (nextState) setState(nextState);
      else await refresh();
      setLeaving((s) => {
        const n = new Set(s);
        n.delete(q.id);
        return n;
      });
      setBusy(null);

      if (promotedIds.length > 0) {
        const first = promotedIds[0] as string;
        setPromoting(new Set(promotedIds));
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        );
        glideSiblings(beforeRects, new Set([...promotedIds, q.id]));
        await travel(first, fromRect);
        setSettled(new Set(promotedIds));
        await delay(promoteSettleDelayMs(reduce));
        setPromoting(new Set());
        setSettled(new Set());
      }
      showToast(
        promoteToastMessage({ promotedCount: promotedIds.length, readOnly: state.readOnly }),
      );
    },
    [
      busy,
      drafts,
      choices,
      relatedDecisions,
      refresh,
      setState,
      showToast,
      state,
      travel,
      glideSiblings,
    ],
  );

  const answerBatch = useCallback(async () => {
    if (batchBusy || state.readOnly) return;
    const text = batchDraft.trim();
    if (!text || batchSelected.size === 0) return;
    setBatchBusy(true);
    try {
      const answers = Array.from(batchSelected).map((questionId) => {
        const conflict = relatedDecisions(
          state.questions.find((q) => q.id === questionId) as Question,
        );
        const decide = conflict.length > 1 ? choices[questionId] : undefined;
        return { questionId, text, ...(decide ? { decide } : {}) };
      });
      const res = await fetch("/api/answer-batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        showToast(body.error ?? "Could not promote batch");
      } else {
        setBatchSelected(new Set());
        setBatchDraft("");
        showToast(`Promoted ${answers.length} question${answers.length === 1 ? "" : "s"}`);
        await refresh();
      }
    } catch {
      showToast("Could not reach the server");
    } finally {
      setBatchBusy(false);
    }
  }, [
    batchBusy,
    batchDraft,
    batchSelected,
    choices,
    relatedDecisions,
    refresh,
    showToast,
    state.questions,
    state.readOnly,
  ]);

  // keyboard: j/k walk the cards, enter answers or traces, / jumps to the
  // first open question. typing stays typing: shortcuts are dead while an
  // input has focus.
  useEffect(() => {
    function isTyping(): boolean {
      const el = document.activeElement;
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    }
    function cards(): HTMLElement[] {
      return Array.from(document.querySelectorAll<HTMLElement>("[data-card]"));
    }
    function onKeyDown(e: KeyboardEvent): void {
      const all = cards();
      const el = document.activeElement;
      const activeCardKind =
        el instanceof HTMLElement && (el.dataset.card === "question" || el.dataset.card === "node")
          ? el.dataset.card
          : undefined;
      const intent = questionKeyboardIntent({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        typing: isTyping(),
        sourcePanelOpen: active !== null,
        activeCardKind,
        cardCount: all.length,
        currentIndex: all.indexOf(el as HTMLElement),
      });
      if (intent.action === "none") return;
      e.preventDefault();
      if (intent.action === "focus-card") all[intent.index]?.focus();
      if (intent.action === "focus-first-answer") {
        document.querySelector<HTMLElement>(".answer-input")?.focus();
      }
      if (intent.action === "focus-active-answer" && el instanceof HTMLElement) {
        el.querySelector<HTMLElement>(".answer-input")?.focus();
      }
      if (intent.action === "trace-active-node" && el instanceof HTMLElement) {
        el.click();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active]);

  return (
    <>
      <main className="columns" aria-busy={status === "loading"}>
        <section className="inbox" aria-label="Questions to settle">
          <div className="section-head">
            <h2>Questions to settle</h2>
            {state.questions.length > 0 && (
              <span className="section-count">{state.questions.length}</span>
            )}
            {state.questions.length > 1 && !state.readOnly && (
              <button
                className="btn mini"
                onClick={() => setBatchMode((b) => !b)}
                aria-pressed={batchMode}
              >
                {batchMode ? "Done" : "Batch"}
              </button>
            )}
          </div>
          {batchMode && (
            <div className="batch-bar">
              <input
                className="answer-input"
                aria-label="Answer for selected questions"
                placeholder={`Answer ${batchSelected.size} selected…`}
                value={batchDraft}
                onChange={(e) => setBatchDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void answerBatch();
                }}
              />
              <button
                className="btn"
                disabled={batchBusy || batchSelected.size === 0 || !batchDraft.trim()}
                onClick={() => void answerBatch()}
              >
                {batchBusy ? "Promoting…" : "Promote selected"}
              </button>
            </div>
          )}
          {status === "loading" && <Skeleton rows={2} />}
          {status === "ready" && state.questions.length === 0 && (
            <p className="empty">Nothing open. The room is settled.</p>
          )}
          <ul className="cards">
            {state.questions.map((q) => {
              const conflict = relatedDecisions(q);
              const isConflict = conflict.length > 1;
              const err = errors[q.id];
              return (
                <li
                  key={q.id}
                  ref={registerCard(q.id)}
                  className={`card question${leaving.has(q.id) ? " leaving" : ""}`}
                  data-card="question"
                  tabIndex={-1}
                >
                  <div className="question-head">
                    {batchMode && (
                      <input
                        type="checkbox"
                        checked={batchSelected.has(q.id)}
                        onChange={(e) => {
                          setBatchSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(q.id);
                            else next.delete(q.id);
                            return next;
                          });
                        }}
                        aria-label={`Select: ${q.prompt}`}
                      />
                    )}
                    <p className="prompt">{q.prompt}</p>
                  </div>

                  {isConflict && (
                    <fieldset className="choices">
                      <legend>Which decision holds?</legend>
                      {conflict.map((d) => (
                        <div key={d.id} className="choice-row">
                          <label className="choice">
                            <input
                              type="radio"
                              name={`choice-${q.id}`}
                              checked={choices[q.id] === d.id}
                              onChange={() => setChoices((c) => ({ ...c, [q.id]: d.id }))}
                            />
                            <span>{d.title}</span>
                          </label>
                          <button
                            className="mini-cite"
                            onClick={() => void showSource(decisionView(d))}
                            onMouseEnter={() => prefetchTrace(d.id)}
                            aria-label={`Source for: ${d.title}`}
                          >
                            {shortId(d.provenance[0]?.evidenceId ?? "")}
                          </button>
                        </div>
                      ))}
                    </fieldset>
                  )}

                  <div className="answer-row">
                    <input
                      className="answer-input"
                      name={`answer-${q.id}`}
                      aria-label={`answer: ${q.prompt}`}
                      placeholder={
                        state.readOnly
                          ? "Try it, nothing is saved…"
                          : isConflict
                            ? "Why does that side hold?"
                            : "Your answer promotes it to decided…"
                      }
                      value={drafts[q.id] ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        const intent = questionInputKeyIntent(e.key);
                        if (intent === "answer") void answer(q);
                        if (intent === "blur") (e.target as HTMLElement).blur();
                      }}
                    />
                    <button
                      className="btn"
                      disabled={busy === q.id || !(drafts[q.id] ?? "").trim()}
                      onClick={() => void answer(q)}
                    >
                      {busy === q.id ? "Promoting…" : "Promote"}
                    </button>
                  </div>
                  <p className="q-meta">
                    {q.provenance[0] && (
                      <>
                        <span>{shortId(q.provenance[0].evidenceId)}</span>
                        <span className="dot">·</span>
                        <span>
                          [{q.provenance[0].start}–{q.provenance[0].end}]
                        </span>
                        <span className="dot">·</span>
                      </>
                    )}
                    <span>{formatConfidence(q.confidence.value)}</span>
                    <span className={`src ${q.confidence.source}`}>{q.confidence.source}</span>
                    <button
                      className="q-trace"
                      onClick={() => void showSource(questionView(q))}
                      onMouseEnter={() => prefetchTrace(q.id)}
                    >
                      {q.provenance.length} span{q.provenance.length === 1 ? "" : "s"}
                      <TraceIcon />
                      <span className="visually-hidden">, trace to source</span>
                    </button>
                  </p>
                  {err && (
                    <p className="card-error" role="alert">
                      {err}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="graph" aria-label="The distilled graph">
          <div className="section-head">
            <h2>Decisions</h2>
            {state.decisions.length > 0 && (
              <span className="section-count">{state.decisions.length}</span>
            )}
          </div>
          {status === "loading" && <Skeleton rows={2} />}
          {status === "ready" && state.decisions.length === 0 && (
            <p className="empty">No decided truth yet.</p>
          )}
          <ul className="cards">
            {state.decisions.map((d) => {
              const v = decisionView(d);
              return (
                <li key={d.id}>
                  <NodeCard
                    view={v}
                    promoting={promoting.has(d.id)}
                    settled={settled.has(d.id)}
                    registerRef={registerCard(d.id)}
                    onTrace={(instant) => void showSource(v, instant)}
                    onIntent={() => prefetchTrace(d.id)}
                    lit={active?.node.id === d.id}
                  />
                </li>
              );
            })}
          </ul>

          <div className="section-head">
            <h2>Entities</h2>
            {state.entities.length > 0 && (
              <span className="section-count">{state.entities.length}</span>
            )}
          </div>
          <ul className="cards">
            {state.entities.map((e) => {
              const v = entityView(e);
              return (
                <li key={e.id}>
                  <NodeCard
                    view={v}
                    promoting={promoting.has(e.id)}
                    settled={settled.has(e.id)}
                    registerRef={registerCard(e.id)}
                    onTrace={(instant) => void showSource(v, instant)}
                    onIntent={() => prefetchTrace(e.id)}
                    lit={active?.node.id === e.id}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      </main>

      {active && (
        <SourcePanel
          node={active.node}
          trace={active.trace}
          instant={active.instant}
          onClose={() => setActive(null)}
        />
      )}

      <p className="keys-hint" aria-hidden>
        j/k move · enter answer or trace · esc close
      </p>

      <div className="toast-region" aria-live="polite">
        {toastMsg && (
          <div className={`toast${toastIn ? " in" : ""}`}>
            <span className="glyph" aria-hidden />
            {toastMsg}
          </div>
        )}
      </div>
    </>
  );
}
