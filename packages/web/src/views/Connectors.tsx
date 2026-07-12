import { useCallback, useEffect, useState } from "react";

import { getJSON } from "../components";
import {
  CONNECTOR_KINDS,
  connectorBlurb,
  connectorMonogram,
  timeAgo,
  type ConnectorView,
} from "../ui";

interface SyncResult {
  name: string;
  itemsIngested: number;
  itemsSkipped: number;
  status: "ok" | "error";
  error?: string;
}

/**
 * The headline surface: the automatic flow of the room into the brain made
 * legible. One card per connector with its live sync state (last sync, items
 * ingested, ok/error/never, the last error if any), an enable toggle, and a
 * sync-now button. Every action is a passthrough to core's SyncEngine and
 * connector config; the web owns no connector logic.
 */
export function ConnectorsView({ readOnly }: { readOnly: boolean }): JSX.Element {
  const [connectors, setConnectors] = useState<ConnectorView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setConnectors(await getJSON<ConnectorView[]>("/api/connectors"));
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

  const toggle = useCallback(
    async (c: ConnectorView) => {
      if (readOnly) return;
      // optimistic flip; reconcile on the server's answer.
      setConnectors((cs) => cs.map((x) => (x.name === c.name ? { ...x, enabled: !x.enabled } : x)));
      try {
        await fetch(`/api/connectors/${encodeURIComponent(c.name)}/enable`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: !c.enabled }),
        });
      } catch {
        await load();
      }
    },
    [readOnly, load],
  );

  const sync = useCallback(
    async (c: ConnectorView) => {
      if (readOnly || syncing) return;
      setSyncing(c.name);
      try {
        const res = await fetch(`/api/connectors/${encodeURIComponent(c.name)}/sync`, {
          method: "POST",
        });
        const body = (await res.json().catch(() => ({}))) as SyncResult & { error?: string };
        if (!res.ok) {
          setNote(body.error ?? `Could not sync ${c.name}`);
        } else if (body.status === "error") {
          setNote(`${c.name}: ${body.error ?? "Sync failed"}`);
        } else {
          setNote(
            `${c.name} synced · ${body.itemsIngested} new, ${body.itemsSkipped} already captured`,
          );
        }
        await load();
      } catch {
        setNote(`Could not reach the server to sync ${c.name}`);
      } finally {
        setSyncing(null);
      }
    },
    [readOnly, syncing, load],
  );

  const totalItems = connectors.reduce((n, c) => n + c.totalItems, 0);
  const flowing = connectors.filter((c) => c.enabled && c.lastStatus === "ok").length;

  return (
    <div className="view view-connectors">
      <header className="view-head">
        <div>
          <h1 className="view-title">Connectors</h1>
          <p className="view-sub">
            The room flows in automatically: Slack, email, meetings, tickets and docs become
            immutable evidence, deduped and distilled. {flowing} flowing ·{" "}
            {totalItems.toLocaleString()} items captured.
          </p>
        </div>
        <button
          className="btn"
          onClick={() => setAdding((a) => !a)}
          disabled={readOnly}
          aria-expanded={adding}
        >
          {adding ? "Close" : "Add connector"}
        </button>
      </header>

      {readOnly && (
        <p className="inline-note">
          Read-only demo: toggles, syncs and new connectors are disabled.
        </p>
      )}

      {adding && !readOnly && (
        <AddConnector
          onCancel={() => setAdding(false)}
          onAdded={async (name) => {
            setAdding(false);
            setNote(`${name} added`);
            await load();
          }}
        />
      )}

      {note && (
        <div className="inline-note live" role="status">
          {note}
        </div>
      )}

      {error ? (
        <p className="empty">Could not load connectors.</p>
      ) : loading ? (
        <div className="connector-grid">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="connector-card skeleton" />
          ))}
        </div>
      ) : connectors.length === 0 ? (
        readOnly ? (
          <p className="empty">
            This demo brain was seeded from files, so it runs no live connectors. Self-hosted,
            connectors like Slack, GitHub, Linear and Notion stream the room in automatically as
            immutable evidence.
          </p>
        ) : (
          <p className="empty">No connectors yet. Add one to start the flow.</p>
        )
      ) : (
        <div className="connector-grid">
          {connectors.map((c) => (
            <article key={c.name} className={`connector-card${c.enabled ? "" : " off"}`}>
              <div className="connector-top">
                <span className="connector-glyph" aria-hidden>
                  {connectorMonogram(c.kind)}
                </span>
                <div className="connector-id">
                  <h3>{c.name}</h3>
                  <p>{connectorBlurb(c.kind)}</p>
                </div>
                <Toggle
                  on={c.enabled}
                  disabled={readOnly}
                  label={`${c.enabled ? "Disable" : "Enable"} ${c.name}`}
                  onChange={() => void toggle(c)}
                />
              </div>

              <div className="connector-stats">
                <div className="cstat">
                  <span className="cstat-value">{c.totalItems.toLocaleString()}</span>
                  <span className="cstat-label">Items</span>
                </div>
                <div className="cstat">
                  <span className="cstat-value">
                    {c.itemsLastRun !== undefined ? `+${c.itemsLastRun}` : "—"}
                  </span>
                  <span className="cstat-label">Last run</span>
                </div>
                <div className="cstat">
                  <span className="cstat-value">{timeAgo(c.lastRunAt)}</span>
                  <span className="cstat-label">Last sync</span>
                </div>
              </div>

              <div className="connector-foot">
                <span className={`conn-status ${c.lastStatus}`}>
                  <span className="status-dot" aria-hidden />
                  {c.lastStatus === "never" ? "Never synced" : c.lastStatus}
                </span>
                <button
                  className="btn ghost"
                  disabled={readOnly || syncing === c.name}
                  onClick={() => void sync(c)}
                >
                  {syncing === c.name ? "Syncing…" : "Sync now"}
                </button>
              </div>

              {c.lastStatus === "error" && c.lastError && (
                <p className="connector-error" role="alert">
                  {c.lastError}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function Toggle({
  on,
  disabled,
  label,
  onChange,
}: {
  on: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}): JSX.Element {
  return (
    <button
      className={`toggle${on ? " on" : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
    >
      <span className="toggle-knob" aria-hidden />
    </button>
  );
}

/** Add a connector: pick a kind, name it, give it settings (JSON) and a secret.
 *  The secret is encrypted at rest by the server before it touches Postgres. */
function AddConnector({
  onCancel,
  onAdded,
}: {
  onCancel: () => void;
  onAdded: (name: string) => void | Promise<void>;
}): JSX.Element {
  const [kind, setKind] = useState<string>(CONNECTOR_KINDS[0]);
  const [name, setName] = useState<string>(CONNECTOR_KINDS[0]);
  const [settings, setSettings] = useState("{}");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setErr(null);
    let parsed: Record<string, unknown>;
    try {
      parsed = settings.trim() ? (JSON.parse(settings) as Record<string, unknown>) : {};
    } catch {
      setErr("Settings must be valid JSON");
      return;
    }
    if (!name.trim()) {
      setErr("A name is required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/connectors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          kind,
          enabled: true,
          settings: parsed,
          ...(secret ? { secret } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(body.error ?? "Could not add the connector");
        return;
      }
      await onAdded(name.trim());
    } catch {
      setErr("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }, [kind, name, settings, secret, onAdded]);

  return (
    <form
      className="add-connector"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="add-row">
        <label className="field">
          <span>Kind</span>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              if (CONNECTOR_KINDS.includes(name as never) || !name) setName(e.target.value);
            }}
          >
            {CONNECTOR_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Slack" />
        </label>
      </div>
      <label className="field">
        <span>Settings (JSON)</span>
        <textarea
          value={settings}
          onChange={(e) => setSettings(e.target.value)}
          rows={3}
          spellCheck={false}
          placeholder='{"channelIds": ["C_PRODUCT"]}'
        />
      </label>
      <label className="field">
        <span>Secret · token or API key, encrypted at rest</span>
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="xoxb-…"
          autoComplete="off"
        />
      </label>
      {err && (
        <p className="card-error" role="alert">
          {err}
        </p>
      )}
      <div className="add-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn" disabled={busy}>
          {busy ? "Saving…" : "Save connector"}
        </button>
      </div>
    </form>
  );
}
