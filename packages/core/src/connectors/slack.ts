import { type IngestInput } from "../marrow.js";
import { type Connector, type ConnectorConfig } from "./index.js";

export interface SlackConfig extends ConnectorConfig {
  botToken: string;
  channelIds?: string[];
}

interface SlackMessage {
  ts: string;
  text?: string;
  user?: string;
  bot_id?: string;
}

export class SlackConnector implements Connector {
  readonly name = "slack";
  constructor(private readonly config: SlackConfig) {}

  private async slackFetch(path: string): Promise<unknown> {
    const res = await fetch(`https://slack.com/api${path}`, {
      headers: {
        Authorization: `Bearer ${this.config.botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
    if (!res.ok) throw new Error(`slack ${path}: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!data.ok) throw new Error(`slack ${path}: ${data.error ?? "unknown"}`);
    return data;
  }

  private async listChannels(): Promise<string[]> {
    if (this.config.channelIds && this.config.channelIds.length > 0) return this.config.channelIds;
    const data = (await this.slackFetch("/conversations.list?types=public_channel")) as {
      channels?: { id: string }[];
    };
    return (data.channels ?? []).map((c) => c.id);
  }

  async fetchSince(since: Date): Promise<IngestInput[]> {
    if (!this.config.enabled) return [];
    const oldest = (since.getTime() / 1000).toFixed(0);
    const channelIds = await this.listChannels();
    const out: IngestInput[] = [];

    for (const channelId of channelIds) {
      let cursor: string | undefined;
      do {
        const params = new URLSearchParams({ channel: channelId, oldest });
        if (cursor) params.set("cursor", cursor);
        const data = (await this.slackFetch(`/conversations.history?${params.toString()}`)) as {
          messages?: SlackMessage[];
          response_metadata?: { next_cursor?: string };
        };
        for (const msg of data.messages ?? []) {
          if (!msg.text) continue;
          out.push({
            text: msg.text,
            source: `slack:${channelId}:${msg.ts}`,
            timestamp: new Date(Number(msg.ts) * 1000),
          });
        }
        cursor = data.response_metadata?.next_cursor;
      } while (cursor);
    }

    return out;
  }
}
