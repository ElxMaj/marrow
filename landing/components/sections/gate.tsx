// Claim 5: the gate. Three shipping commands around every agent task: brief
// before, check during, annotate in CI. One ledger, no cards, no theater.
const ENTRIES = [
  {
    step: "MCP",
    title: "prepare_task returns the brief",
    body: "The agent gets decided goals, decisions, contested facts, open questions and source spans for one task. It also gets a build or ask-a-human signal.",
    code: 'prepare_task({ task: "require a card at signup" })',
  },
  {
    step: "CLI",
    title: "loop --check scans the diff",
    body: "New code is compared against decided truth. A contradiction creates an open question, a catch event, receipt data and the next accept or dismiss command.",
    code: 'marrow loop "require a card at signup" --check --unstaged',
  },
  {
    step: "CI + daily",
    title: "drift --ci and truth keep it current",
    body: "CI annotates PRs, while the daily brief shows proposed goals, contested facts, unanswered gaps, pending catches and connector health.",
    code: "marrow drift --ci && marrow truth",
  },
];

export function Gate() {
  return (
    <section className="claim" id="gate" aria-label="The drift gate">
      <p className="claim-kicker" data-reveal>
        05 · The gate
      </p>
      <h2 className="claim-title" data-reveal>
        Drift gets caught before it ships.
      </h2>
      <p className="claim-support" data-reveal>
        One gate around every agent task. It speaks MCP, so it serves any agent host: Claude Code,
        Cursor, Codex, or your own.
      </p>
      <div className="sheet" data-reveal>
        <p className="sheet-head">
          GATE · <span className="id">before, during and after the work</span>
        </p>
        <div className="gate-rows">
          {ENTRIES.map((e) => (
            <div className="gate-row" key={e.step}>
              <span className="gate-step">{e.step}</span>
              <div>
                <h3>{e.title}</h3>
                <p>{e.body}</p>
                <code>{e.code}</code>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
