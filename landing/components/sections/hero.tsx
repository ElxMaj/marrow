import { CmdChip } from "@/components/ui/copy";
import { CiteButton } from "@/components/ui/cite";
import { CITE } from "@/content/citations";
import { DEMO_URL } from "@/content/links";

// The claim and the product as living artifact. The provenance beam is CSS
// only (plays before hydration, two cycles, then rests as an ember at the
// gate) so the first viewport has zero JS dependency: LCP is the H1's first
// paint. The section keeps class="cover" and the H1 string byte for byte;
// the launch preflight pins both.
export function Hero() {
  return (
    <section className="cover" id="cover">
      <div className="cover-grid">
        <div className="cover-copy">
          <p className="eyebrow">The product context layer for coding agents</p>
          <h1 className="cover-title">Your coding agent has never been in the room.</h1>
          <p className="standfirst">
            <strong className="standfirst-punch">Marrow puts it there.</strong> It turns
            transcripts, standups and interviews into decided vs open product truth, and serves your
            agent the slice that matters for its task.
          </p>
          <div className="cover-actions">
            <CmdChip command="npx @marrowhq/cli demo" />
            {/* arrive where the landing's promise waits: the question loop */}
            <a className="btn btn-ghost" href={`${DEMO_URL}/#/questions`} data-demo-link>
              Open the live demo
            </a>
          </div>
          <p className="cover-note">
            The demo needs local Postgres. The live demo needs nothing.{" "}
            <a className="cover-source" href="#start">
              Run from source ↓
            </a>
          </p>
          <div className="cover-trust" aria-label="Marrow trust guarantees">
            <span>Apache 2.0</span>
            <span>One Postgres</span>
            <span>Human promotes</span>
            <span>MCP native</span>
          </div>
          <p className="cover-hosts">Works with Claude Code · Cursor · Codex · any MCP host</p>
        </div>

        <aside className="hero-console" aria-label="Product context preview">
          <div className="console-top">
            <span className="console-dot"></span>
            <span>prepare_task</span>
            <code>task: &quot;require a card at signup&quot;</code>
          </div>
          <div className="console-flow">
            <span className="beam" aria-hidden="true"></span>
            <div className="console-panel panel-room">
              <span className="panel-label">Raw room</span>
              <p>
                &quot;Free trial, no card until they convert.&quot;{" "}
                <CiteButton cite={CITE.noCard} />
              </p>
            </div>
            <div className="console-panel panel-truth">
              <span className="panel-label">Product truth</span>
              <div className="mini-row">
                <span className="mini-status mini-decided">decided</span>
                <span>Free trial, no card upfront</span>
              </div>
              <div className="mini-row">
                <span className="mini-status mini-open">open</span>
                <span>Trial length needs a human call</span>
              </div>
              <div className="mini-row">
                <span className="mini-status mini-contested">contested</span>
                <span>Two trial lengths stay visible</span>
              </div>
            </div>
            <div className="console-panel panel-agent">
              <span className="panel-label">Agent gate</span>
              <p>
                A card wall at signup contradicts a decided fact. Ask before building, and cite the
                evidence in the PR.
              </p>
              <code>
                context: 4 facts, not the whole brain
                <span className="caret" aria-hidden="true" />
              </code>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
