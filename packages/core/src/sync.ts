import { type ConnectorSyncResult } from "@marrowhq/shared";

import { type Connector } from "./connectors/index.js";
import { FigmaConnector } from "./connectors/figma.js";
import { GitHubIssuesConnector } from "./connectors/github.js";
import { IntercomConnector } from "./connectors/intercom.js";
import { LinearConnector } from "./connectors/linear.js";
import { NotionConnector } from "./connectors/notion.js";
import { SlackConnector } from "./connectors/slack.js";
import { ZoomConnector } from "./connectors/zoom.js";
import { EmailConnector } from "./connectors/email.js";
import { TeamsConnector } from "./connectors/teams.js";
import { JiraConnector } from "./connectors/jira.js";
import { GranolaConnector } from "./connectors/granola.js";
import { OtterConnector } from "./connectors/otter.js";
import { decryptSecret } from "./crypto.js";
import { type Store } from "./store.js";

// The sync engine turns configured connectors into a steady, automatic flow of
// evidence into the brain. It is the durable layer: each run pulls only what is
// new (a cursor in connector_state), never double-ingests (dedup by source on
// append-only evidence), advances the cursor only on success, and records a run
// so every sync is visible in observability. Because each run is idempotent it
// is safe to retry and safe to schedule, which is the Temporal-shaped property
// on one Postgres, no external workflow engine.

const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined;
const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/**
 * Build a live Connector from a stored config: its kind, its non-secret
 * settings, and its decrypted secret. One place that knows how each connector's
 * config is shaped, so the rest of the system treats connectors uniformly.
 */
export function buildConnector(
  kind: string,
  settings: Record<string, unknown>,
  secret?: string,
): Connector {
  const enabled = true;
  const since = asString(settings.since);
  const base = { enabled, ...(since ? { since: new Date(since) } : {}) };
  // optional fields are read into a const first so the truthy spread narrows
  // string[]|undefined down to string[], which exactOptionalPropertyTypes needs.
  const token = secret ?? "";
  switch (kind) {
    case "slack": {
      const channelIds = asStringArray(settings.channelIds);
      return new SlackConnector({
        ...base,
        botToken: token,
        ...(channelIds !== undefined ? { channelIds } : {}),
      });
    }
    case "github":
      return new GitHubIssuesConnector({
        ...base,
        token,
        repos: (Array.isArray(settings.repos) ? settings.repos : []) as {
          owner: string;
          repo: string;
        }[],
      });
    case "linear": {
      const teamIds = asStringArray(settings.teamIds);
      return new LinearConnector({
        ...base,
        token,
        ...(teamIds !== undefined ? { teamIds } : {}),
      });
    }
    case "notion": {
      const pageIds = asStringArray(settings.pageIds);
      const databaseIds = asStringArray(settings.databaseIds);
      return new NotionConnector({
        ...base,
        token,
        ...(pageIds !== undefined ? { pageIds } : {}),
        ...(databaseIds !== undefined ? { databaseIds } : {}),
      });
    }
    case "figma": {
      const fileKeys = asStringArray(settings.fileKeys);
      return new FigmaConnector({
        ...base,
        token,
        ...(fileKeys !== undefined ? { fileKeys } : {}),
      });
    }
    case "zoom":
      return new ZoomConnector({
        ...base,
        accountId: asString(settings.accountId) ?? "",
        clientId: asString(settings.clientId) ?? "",
        clientSecret: token,
      });
    case "intercom":
      return new IntercomConnector({ ...base, token });
    case "email": {
      const query = asString(settings.query);
      const labelIds = asStringArray(settings.labelIds);
      return new EmailConnector({
        ...base,
        accessToken: token,
        ...(query !== undefined ? { query } : {}),
        ...(labelIds !== undefined ? { labelIds } : {}),
      });
    }
    case "teams": {
      const channelIds = asStringArray(settings.channelIds);
      return new TeamsConnector({
        ...base,
        accessToken: token,
        teamId: asString(settings.teamId) ?? "",
        ...(channelIds !== undefined ? { channelIds } : {}),
      });
    }
    case "jira": {
      const jql = asString(settings.jql);
      const projectKeys = asStringArray(settings.projectKeys);
      return new JiraConnector({
        ...base,
        baseUrl: asString(settings.baseUrl) ?? "",
        email: asString(settings.email) ?? "",
        apiToken: token,
        ...(jql !== undefined ? { jql } : {}),
        ...(projectKeys !== undefined ? { projectKeys } : {}),
      });
    }
    case "granola": {
      const baseUrl = asString(settings.baseUrl);
      const folderId = asString(settings.folderId);
      return new GranolaConnector({
        ...base,
        apiToken: token,
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        ...(folderId !== undefined ? { folderId } : {}),
      });
    }
    case "otter": {
      const baseUrl = asString(settings.baseUrl);
      const channelId = asString(settings.channelId);
      const includeShared =
        typeof settings.includeShared === "boolean" ? settings.includeShared : undefined;
      return new OtterConnector({
        ...base,
        apiKey: token,
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        ...(channelId !== undefined ? { channelId } : {}),
        ...(includeShared !== undefined ? { includeShared } : {}),
      });
    }
    default:
      throw new Error(`sync: unknown connector kind "${kind}"`);
  }
}

/** The kinds the factory knows how to build, for validation and UI listings. */
export const CONNECTOR_KINDS = [
  "slack",
  "github",
  "linear",
  "notion",
  "figma",
  "zoom",
  "intercom",
  "email",
  "teams",
  "jira",
  "granola",
  "otter",
] as const;
export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];

export interface SyncEngineDeps {
  store: Store;
  /** when wired, each newly ingested item is enqueued for distillation. */
  /** the key that decrypts stored connector secrets. defaults to env. */
  secretKey?: string | undefined;
}

/**
 * Runs connector syncs against a Store. Reads which connectors are configured
 * and enabled, pulls each since its cursor, dedups, ingests as immutable
 * evidence, advances the cursor on success, and records a connector_sync run.
 */
export class SyncEngine {
  constructor(private readonly deps: SyncEngineDeps) {}

  private async resolve(name: string): Promise<Connector> {
    const cfg = await this.deps.store.getConnectorConfig(name);
    if (!cfg) throw new Error(`sync: connector "${name}" is not configured`);
    const cipher = await this.deps.store.getConnectorSecretCipher(name);
    const secret = cipher ? decryptSecret(cipher, this.deps.secretKey) : undefined;
    return buildConnector(cfg.kind, cfg.settings, secret);
  }

  /** Run one configured connector by name. */
  async runConnector(name: string): Promise<ConnectorSyncResult> {
    return this.runConnectorInstance(name, await this.resolve(name));
  }

  /**
   * Run a given connector instance: pull since the stored cursor, dedup by
   * source, ingest new items as evidence, enqueue distillation, advance the
   * cursor on success, and record the run. Exposed so callers can sync a
   * connector built from env instead of stored config, and so tests can pass a
   * fake connector. Serialized per connector with an advisory lock so two
   * concurrent syncs of the same connector cannot both clear the dedup check and
   * double-ingest the same source (F-CORE-044/050).
   */
  async runConnectorInstance(name: string, connector: Connector): Promise<ConnectorSyncResult> {
    return this.deps.store.withConnectorLock(name, () =>
      this.runConnectorUnlocked(name, connector),
    );
  }

  private async runConnectorUnlocked(
    name: string,
    connector: Connector,
  ): Promise<ConnectorSyncResult> {
    const state = await this.deps.store.getConnectorState(name);
    const since = state?.cursor ? new Date(state.cursor) : new Date(0);
    const ranAt = new Date().toISOString();
    const start = Date.now();

    let itemsIngested = 0;
    let itemsSkipped = 0;
    let status: "ok" | "error" = "ok";
    let error: string | undefined;
    // the newest source-side timestamp we have seen this run. the cursor must
    // advance to this high-water mark, never to the local wall clock: if our
    // clock runs ahead of the provider's, a wall-clock cursor skips items that
    // were posted before the run but only became visible after it.
    let watermark: Date | undefined;

    try {
      const drafts = await connector.fetchSince(since);
      for (const draft of drafts) {
        // a skipped item still advances the watermark, so a boundary item that
        // dedup keeps re-delivering does not pin the cursor in the past forever.
        if (draft.timestamp && (!watermark || draft.timestamp > watermark)) {
          watermark = draft.timestamp;
        }
        // evidence is append only: dedup is a skip, never an update.
        if (await this.deps.store.hasEvidenceSource(draft.source)) {
          itemsSkipped += 1;
          continue;
        }
        await this.deps.store.insertEvidence({
          text: draft.text,
          source: draft.source,
        });
        itemsIngested += 1;
      }
    } catch (err) {
      status = "error";
      error = err instanceof Error ? err.message : String(err);
    }

    // prefer the high-water mark; fall back to wall clock only for connectors
    // that do not report per-item timestamps, preserving their behavior.
    const cursor = watermark ? watermark.toISOString() : ranAt;

    const latencyMs = Date.now() - start;
    const run = await this.deps.store.recordRun({
      kind: "connector_sync",
      status,
      label: name,
      latencyMs,
      ...(status === "ok"
        ? { outputSummary: `${itemsIngested} ingested, ${itemsSkipped} skipped` }
        : { error }),
      metadata: { itemsIngested, itemsSkipped },
    });

    await this.deps.store.recordSyncOutcome(name, {
      ok: status === "ok",
      ...(status === "ok" ? { cursor } : {}),
      itemsIngested,
      ...(error ? { error } : {}),
      ranAt,
    });

    return {
      name,
      itemsIngested,
      itemsSkipped,
      status,
      ...(error ? { error } : {}),
      runId: run.id,
    };
  }

  /** Run every enabled, configured connector, in order. one result each. */
  async runAll(): Promise<ConnectorSyncResult[]> {
    const configs = await this.deps.store.listConnectorConfigs();
    const results: ConnectorSyncResult[] = [];
    for (const cfg of configs) {
      if (!cfg.enabled) continue;
      results.push(await this.runConnector(cfg.name));
    }
    return results;
  }
}
