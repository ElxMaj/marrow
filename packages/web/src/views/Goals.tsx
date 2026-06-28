import { useCallback, useEffect, useState } from "react";

import {
  Badge,
  getJSON,
  goalView,
  prefetchTrace,
  SourcePanel,
  TraceIcon,
  useTrace,
} from "../components";
import { formatConfidence, provenanceWeight, shortId, type GoalView } from "../ui";

/**
 * The Goals space: where the product team writes the targets the product and its
 * users must hit, sees the goals the agent proposed from the room, and reads
 * where code drifts from a decided goal. A thin window onto core: authoring goes
 * through core.authorGoal (a human act, so it lands decided with the team's words
 * kept as evidence); the open goals and the drift live in core, settled in the
 * question loop. No product logic here.
 */
export function GoalsView({ readOnly }: { readOnly: boolean }): JSX.Element {
  const [goals, setGoals] = useState<GoalView[]>([]);
  const [entities, setEntities] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [goalType, setGoalType] = useState<"product" | "user">("product");
  const [entityId, setEntityId] = useState("");

  const { active, open, close } = useTrace();

  const load = useCallback(async () => {
    try {
      const [g, state] = await Promise.all([
        getJSON<GoalView[]>("/api/goals"),
        getJSON<{ entities: { id: string; name: string }[] }>("/api/state"),
      ]);
      setGoals(g);
      setEntities(state.entities);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 3200);
    return () => clearTimeout(t);
  }, [note]);

  const submit = useCallback(async () => {
    if (readOnly || busy) return;
    const t = title.trim();
    if (!t) return;
    setBusy(true);
    try {
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: t,
          ...(description.trim() ? { description: description.trim() } : {}),
          goalType,
          ...(entityId ? { entityId } : {}),
        }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setNote(e.error ?? "Could not author that goal");
      } else {
        setTitle("");
        setDescription("");
        setEntityId("");
        setNote("authored · decided, with your statement kept as evidence");
        await load();
      }
    } catch {
      setNote("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }, [readOnly, busy, title, description, goalType, entityId, load]);

  const product = goals.filter((g) => g.goalType === "product");
  const user = goals.filter((g) => g.goalType === "user");

  const onOpen = useCallback((g: GoalView, instant: boolean) => open(goalView(g), instant), [open]);
  const onIntent = useCallback((g: GoalView) => prefetchTrace(g.id), []);

  return (
    <div className="view view-goals">
      <header className="view-head">
        <div>
          <h1 className="view-title">Goals</h1>
          <p className="view-sub">
            The targets the product and its users must hit. Add a goal and it is decided, with your
            words kept as evidence. Goals the agent proposed from the room arrive open — you settle
            them in the question loop, where code that drifts from a decided goal also surfaces.
          </p>
        </div>
      </header>

      <section className="goal-author" aria-label="Author a goal">
        <div className="goal-fields">
          <label className="field span-2">
            <span>Goal</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What must the product, or a user, be able to achieve?"
              disabled={readOnly}
            />
          </label>
          <label className="field">
            <span>Type</span>
            <select
              value={goalType}
              onChange={(e) => setGoalType(e.target.value as "product" | "user")}
              disabled={readOnly}
            >
              <option value="product">product goal</option>
              <option value="user">user goal</option>
            </select>
          </label>
          <label className="field">
            <span>Serves</span>
            <select
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              disabled={readOnly}
            >
              <option value="">No feature yet</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field span-2">
            <span>Detail</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="The outcome, the constraint, the why (optional)"
              rows={2}
              disabled={readOnly}
              spellCheck={false}
            />
          </label>
        </div>
        <div className="add-actions">
          <button
            className="btn"
            onClick={() => void submit()}
            disabled={readOnly || busy || !title.trim()}
          >
            {busy ? "Authoring…" : "Author goal"}
          </button>
        </div>
      </section>

      {readOnly && (
        <p className="inline-note">Read-only demo: authoring is disabled. The goals still read.</p>
      )}
      {note && (
        <div className="inline-note live" role="status">
          {note}
        </div>
      )}

      {error ? (
        <p className="empty">Could not load goals.</p>
      ) : loading ? (
        <div className="goals-grid" aria-hidden>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="goal-card skeleton" />
          ))}
        </div>
      ) : (
        <>
          <GoalSection
            title="Product goals"
            hint="what the product must do"
            goals={product}
            onOpen={onOpen}
            onIntent={onIntent}
          />
          <GoalSection
            title="User goals"
            hint="what a user must be able to do"
            goals={user}
            onOpen={onOpen}
            onIntent={onIntent}
          />
        </>
      )}

      {active && (
        <SourcePanel
          node={active.node}
          trace={active.trace}
          instant={active.instant}
          onClose={close}
        />
      )}
    </div>
  );
}

function GoalSection({
  title,
  hint,
  goals,
  onOpen,
  onIntent,
}: {
  title: string;
  hint: string;
  goals: GoalView[];
  onOpen: (g: GoalView, instant: boolean) => void;
  onIntent: (g: GoalView) => void;
}): JSX.Element {
  return (
    <section className="goal-section" aria-label={title}>
      <div className="section-head">
        <h2>
          {title} <span className="section-hint">· {hint}</span>
        </h2>
        {goals.length > 0 && <span className="section-count">{goals.length}</span>}
      </div>
      {goals.length === 0 ? (
        <p className="empty small">No {title.toLowerCase()} yet. Add one above.</p>
      ) : (
        <div className="goals-grid">
          {goals.map((g, i) => (
            <GoalCard key={g.id} goal={g} index={i} onOpen={onOpen} onIntent={onIntent} />
          ))}
        </div>
      )}
    </section>
  );
}

function GoalCard({
  goal,
  index,
  onOpen,
  onIntent,
}: {
  goal: GoalView;
  index: number;
  onOpen: (g: GoalView, instant: boolean) => void;
  onIntent: (g: GoalView) => void;
}): JSX.Element {
  const spans = goal.provenance.length;
  const first = goal.provenance[0];
  const decided = goal.status === "decided";
  return (
    <button
      className={`node w${provenanceWeight(spans)} goal-card`}
      style={{ "--i": index } as React.CSSProperties}
      onClick={(e) => onOpen(goal, e.detail === 0)}
      onMouseEnter={() => onIntent(goal)}
      onFocus={() => onIntent(goal)}
    >
      <span className="node-head">
        <Badge status={goal.status} />
        {goal.entityName ? (
          <span className="goal-serves">Serves {goal.entityName}</span>
        ) : (
          <span className="goal-serves unattached">Unattached</span>
        )}
      </span>
      <span className={`node-title${decided ? " is-decided" : ""}`}>{goal.title}</span>
      {goal.description && <span className="node-sub">{goal.description}</span>}
      <span className="node-meta">
        {first && (
          <>
            <span>{shortId(first.evidenceId)}</span>
            <span className="dot">·</span>
          </>
        )}
        <span>{formatConfidence(goal.confidence.value)}</span>
        <span className={`src ${goal.confidence.source}`}>{goal.confidence.source}</span>
        <span className="trace-cue">
          {spans} span{spans === 1 ? "" : "s"}
          <TraceIcon />
        </span>
      </span>
    </button>
  );
}
