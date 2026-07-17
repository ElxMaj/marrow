// One context layer, every agent workflow. Six cells, each a shipped command
// or MCP tool from the README, nothing speculative.
const CELLS = [
  {
    title: "Brief the agent",
    body: "Task-scoped decided and open facts before a line is written.",
    code: 'prepare_task({ task: "…" })',
  },
  {
    title: "Gate a risky diff",
    body: "Compare new code against decided truth, catch the contradiction.",
    code: 'marrow loop "<task>" --check --unstaged',
  },
  {
    title: "Annotate PRs in CI",
    body: "Drift annotations land on the pull request, with receipts.",
    code: "marrow drift --ci",
  },
  {
    title: "Answer why it is like this",
    body: "Any fact traces to the exact sentence in the room that made it true.",
    code: "trace_to_source",
  },
  {
    title: "Keep truth fresh",
    body: "The daily brief: proposed goals, contested facts, gaps, catches.",
    code: "marrow truth",
  },
  {
    title: "Review as the human",
    body: "The question loop in a browser. Your answers promote facts.",
    code: "marrow web",
  },
];

export function UseGrid() {
  return (
    <section className="claim" id="workflows" aria-label="Agent workflows">
      <p className="claim-kicker" data-reveal>
        07 · Workflows
      </p>
      <h2 className="claim-title" data-reveal>
        One context layer, every agent workflow.
      </h2>
      <div className="use-grid" data-reveal>
        {CELLS.map((c) => (
          <div className="use-cell" key={c.title}>
            <h3>{c.title}</h3>
            <p>{c.body}</p>
            <code>{c.code}</code>
          </div>
        ))}
      </div>
      <p className="hosts-line">Works with Claude Code · Cursor · Codex · any MCP host.</p>
    </section>
  );
}
