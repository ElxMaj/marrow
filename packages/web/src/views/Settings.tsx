import { useEffect, useRef, useState } from "react";

import { copyTextWithFallback, type SandboxState } from "../ui";

export const MARROW_DOCS_URL = "https://github.com/ElxMaj/marrow#readme";

const MCP_SNIPPET = `{
  "mcpServers": {
    "marrow": {
      "command": "npx",
      "args": ["-y", "@marrowhq/mcp-server"],
      "env": { "DATABASE_URL": "postgres://…/marrow" }
    }
  }
}`;

/**
 * Settings: a brain summary, where connector secrets live (encrypted at rest),
 * the MCP connection snippet a coding agent uses to pull task-scoped context,
 * and links out. A thin window: it surfaces facts about the brain, it owns no
 * configuration logic.
 */
export function SettingsView({
  state,
  readOnly,
}: {
  state: SandboxState;
  readOnly: boolean;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const snippetRef = useRef<HTMLPreElement>(null);
  const decided = state.decisions.filter((d) => d.status === "decided").length;

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <div className="view view-settings">
      <header className="view-head">
        <div>
          <h1 className="view-title">Settings</h1>
          <p className="view-sub">How this brain is wired, and how an agent connects to it.</p>
        </div>
      </header>

      <section className="settings-section">
        <h2>This brain</h2>
        <dl className="settings-list">
          <Row label="Decided decisions" value={String(decided)} />
          <Row label="Open questions" value={String(state.questions.length)} />
          <Row label="Entities" value={String(state.entities.length)} />
          <Row label="Mode" value={readOnly ? "Read-only demo" : "Local · writable"} />
          <Row label="Storage" value="One Postgres + pgvector" />
        </dl>
      </section>

      <section className="settings-section">
        <h2>Connector secrets</h2>
        <p className="settings-prose">
          Tokens and API keys are encrypted with AES-256-GCM before they touch the database. The key
          is derived from <code>MARROW_SECRET_KEY</code>, which a self-hoster controls, so a
          database dump alone never leaks a connection. Secrets are never returned to the browser;
          the connector view only reports whether one is set.
        </p>
      </section>

      <section className="settings-section">
        <h2>Connect an agent over MCP</h2>
        <p className="settings-prose">
          Marrow serves task-scoped context to coding agents over MCP. Point your agent at the
          server and it pulls only the decided-vs-open truth a task needs, with provenance.
        </p>
        <div className="snippet">
          <button
            className="snippet-copy"
            onClick={() => {
              setCopied(true);
              void copyTextWithFallback(MCP_SNIPPET, snippetRef.current);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <pre ref={snippetRef}>{MCP_SNIPPET}</pre>
        </div>
      </section>

      <section className="settings-section">
        <h2>More</h2>
        <div className="settings-links">
          <a className="settings-link" href={MARROW_DOCS_URL} target="_blank" rel="noreferrer">
            Docs
          </a>
          <a
            className="settings-link"
            href="https://github.com/ElxMaj/marrow/discussions"
            target="_blank"
            rel="noreferrer"
          >
            Support
          </a>
          <a
            className="settings-link"
            href="https://github.com/ElxMaj/marrow"
            target="_blank"
            rel="noreferrer"
          >
            Source
          </a>
        </div>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="settings-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
