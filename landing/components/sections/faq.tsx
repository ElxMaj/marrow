import { GITHUB_DISCUSSIONS_URL, GITHUB_ISSUES_URL, GITHUB_URL } from "@/content/links";

// Cross-examination: the skeptic questions, honest answers, native details.
// The comparison lives here too, as answers instead of a table.
const FAQS: { q: string; a: React.ReactNode; open?: boolean }[] = [
  {
    q: "Does Marrow read my codebase?",
    open: true,
    a: (
      <p>
        Only when you ask it to: the one-time onboarding scan at setup, and the diff checks you run
        with --check. The room is the source of truth, never the repo. Marrow watches the gap
        between what the room decided and what the code does, then raises that gap as a question. It
        never rewrites product truth from code.
      </p>
    ),
  },
  {
    q: "Why not Notion RAG, or an AGENTS.md?",
    a: (
      <p>
        Retrieval over docs returns text. Marrow returns status-bearing truth: decided vs open,
        confidence, and the exact source span, kept current by the room instead of stale hand edits.
        An AGENTS.md is where task conventions belong; the product decisions behind them are what
        Marrow serves.
      </p>
    ),
  },
  {
    q: "Why not Lore, Tenet, or another code memory tool?",
    a: (
      <p>
        They distill from git: what the repo does and how it changed. Marrow distills from the room:
        what the code should do, decided by people. The room is the one source a code memory tool
        cannot reach. Run both if you like; they answer different questions.
      </p>
    ),
  },
  {
    q: "What if we don't record meetings?",
    a: (
      <p>
        Most decided truth is already written down: standups in Slack, decisions in Linear or
        Notion, customer notes, pasted call summaries. Marrow ingests markdown, text and transcript
        files the same way, and the connectors pull from the tools directly. Recording helps, it is
        not required.
      </p>
    ),
  },
  {
    q: "Where does my data go?",
    a: (
      <p>
        Self-hosted data is stored in your Postgres. Distillation sends selected evidence to the
        model provider you configure unless you use a local provider. Connector tokens are encrypted
        at rest before they touch the database, and you bring your own model keys.
      </p>
    ),
  },
  {
    q: "Will it slow my agent down?",
    a: (
      <p>
        Retrieval is task-scoped and bounded: about 2.5x fewer context tokens than a raw dump on the
        synthetic benchmark, with average retrieval under 5 ms on the fixture run. Every distill,
        search and drift check is recorded, so you can see latency and cost yourself.
      </p>
    ),
  },
  {
    q: "Is the evidence really immutable?",
    a: (
      <p>
        Marrow&apos;s application paths and migrations expose append-only evidence writes.
        Corrections create new evidence rows, so every decided fact keeps tracing to the exact
        source span it came from. A self-hosted database admin still controls their own Postgres.
      </p>
    ),
  },
  {
    q: "How mature is it?",
    a: (
      <p>
        Early. The local core covers the hero loop end to end: ingest room evidence, distill
        provenanced truth, serve task-scoped briefs over CLI and MCP, and raise drift catches with
        receipts. The benchmark is synthetic until partner data exists.
      </p>
    ),
  },
];

export function Faq() {
  return (
    <section className="faq" id="faq" aria-label="Questions and answers">
      <p className="claim-kicker" data-reveal>
        10 · Questions
      </p>
      <h2 className="claim-title" data-reveal>
        The skeptic round.
      </h2>
      <div className="faq-list" data-reveal>
        {FAQS.map((f) => (
          <details className="faq-item" key={f.q} open={f.open}>
            <summary>{f.q}</summary>
            {f.a}
          </details>
        ))}
      </div>
      <p className="faq-foot">
        The full comparisons, including when to pick the other tool, live in{" "}
        <a href={`${GITHUB_URL}/tree/main/docs/compare`}>docs/compare</a>. Anything else:{" "}
        <a href={GITHUB_ISSUES_URL}>open an issue</a> or{" "}
        <a href={GITHUB_DISCUSSIONS_URL}>ask in discussions</a>. We answer.
      </p>
    </section>
  );
}
