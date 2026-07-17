import { IntakeLine } from "@/components/ui/copy";
import { GITHUB_URL, NPM_URL } from "@/content/links";

// The argued star ask, next to the exit ramp. Everything the page just did is
// in the repo: the demo, the MCP server, the drift gate. The install panel
// keeps the from-source trio in the exact order the launch preflight pins.
export function Oss() {
  return (
    <section className="claim" id="start" aria-label="Open source and get started">
      <p className="claim-kicker" data-reveal>
        08 · Open source
      </p>
      <h2 className="claim-title" data-reveal>
        100% open source. One Postgres. No asterisks.
      </h2>
      <div className="oss-grid">
        <div className="oss-pitch" data-reveal>
          <p className="claim-support">
            Everything this page just did is in the repo. The demo you can run, the MCP server your
            agent talks to, the drift gate, the question loop. Apache 2.0, self-hosted on one
            Postgres with pgvector, no Redis, no Kafka, no vector service.
          </p>
          <ul className="oss-points">
            <li>
              The four sacred things are never gated: decided vs open, provenance, the question
              loop, task-scoped retrieval.
            </li>
            <li>Bring your own model key. Default Claude, never assumed.</li>
            <li>Evidence is append only. Your Postgres, your record.</li>
          </ul>
          <div className="oss-actions">
            <a className="btn btn-primary" href={GITHUB_URL}>
              <span className="star" aria-hidden="true">
                ★
              </span>
              Star ElxMaj/marrow
            </a>
            <a className="btn btn-ghost" href={NPM_URL}>
              @marrowhq/cli on npm
            </a>
          </div>
          <p className="oss-note">
            If the loop earned it, the star is how you say build more of this.
          </p>
        </div>
        <div className="oss-panel" data-reveal>
          <div className="sheet intake-sheet">
            <p className="sheet-head">
              INSTALL · <span className="id">@marrowhq/cli</span>
            </p>
            <div className="intake-lines">
              <IntakeLine command="npx @marrowhq/cli demo">
                # The hero slice end to end, no key
              </IntakeLine>
              <IntakeLine command="claude mcp add marrow -- npx -y @marrowhq/mcp-server">
                # Point Claude Code at the brain over MCP
              </IntakeLine>
              <IntakeLine command='npx @marrowhq/cli loop "require a card at signup" --check --unstaged'>
                # Give the agent the gate before it edits code
              </IntakeLine>
              <IntakeLine command="npx @marrowhq/cli truth">
                # Review the daily product-truth queue
              </IntakeLine>
              <IntakeLine command="npx @marrowhq/cli web">
                # Open the question-loop UI in your browser
              </IntakeLine>
              <IntakeLine command="npx @marrowhq/cli ingest ./meetings">
                # Ingest the meetings you already export (.md .txt .vtt .srt)
              </IntakeLine>
            </div>
          </div>
          <div className="sheet intake-sheet intake-source">
            <p className="sheet-head">
              RUN FROM SOURCE · <span className="id">github.com/ElxMaj/marrow</span>
            </p>
            <div className="intake-lines">
              <IntakeLine command="pnpm db:up"># Start local Postgres + pgvector</IntakeLine>
              <IntakeLine command="pnpm db:migrate"># Run the migrations</IntakeLine>
              <IntakeLine command="pnpm marrow demo"># The same demo, from the clone</IntakeLine>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
