import { type IngestInput } from "../marrow.js";
import { type Connector, type ConnectorConfig } from "./index.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export interface TeamsConfig extends ConnectorConfig {
  accessToken: string;
  teamId: string;
  channelIds?: string[];
}

interface TeamsChannel {
  id: string;
}

interface TeamsMessage {
  id: string;
  messageType?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string | null;
  body?: { contentType?: string; content?: string };
}

interface TeamsPage<T> {
  value?: T[];
  "@odata.nextLink"?: string;
}

export class TeamsConnector implements Connector {
  readonly name = "teams";
  constructor(private readonly config: TeamsConfig) {}

  // accepts a relative graph path or a full @odata.nextLink url
  private async graphFetch(url: string): Promise<unknown> {
    const full = url.startsWith("http") ? url : `${GRAPH_BASE}${url}`;
    const res = await fetch(full, {
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) throw new Error(`teams ${url}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  private async listChannels(): Promise<string[]> {
    if (this.config.channelIds && this.config.channelIds.length > 0) return this.config.channelIds;
    const data = (await this.graphFetch(
      `/teams/${this.config.teamId}/channels`,
    )) as TeamsPage<TeamsChannel>;
    return (data.value ?? []).map((c) => c.id);
  }

  async fetchSince(since: Date): Promise<IngestInput[]> {
    if (!this.config.enabled) return [];
    const channelIds = await this.listChannels();
    const out: IngestInput[] = [];

    for (const channelId of channelIds) {
      let next: string | undefined = `/teams/${this.config.teamId}/channels/${channelId}/messages`;
      while (next) {
        const page = (await this.graphFetch(next)) as TeamsPage<TeamsMessage>;
        for (const msg of page.value ?? []) {
          // skip system messages (joins, renames, etc), keep real posts
          if ((msg.messageType ?? "") !== "message") continue;
          const stamp = msg.lastModifiedDateTime ?? msg.createdDateTime;
          if (stamp && new Date(stamp) < since) continue;
          const text = stripHtml(msg.body?.content ?? "");
          if (!text) continue;
          out.push({
            text,
            source: `teams:${this.config.teamId}:${channelId}:${msg.id}`,
            ...(stamp ? { timestamp: new Date(stamp) } : {}),
          });
        }
        next = page["@odata.nextLink"];
      }
    }

    return out;
  }
}

// teams message bodies are html; reduce them to plain text for distillation
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
