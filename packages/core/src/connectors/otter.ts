import { type IngestInput } from "../marrow.js";
import { type Connector, type ConnectorConfig } from "./index.js";

const DEFAULT_BASE_URL = "https://api.otter.ai/v1";

export interface OtterConfig extends ConnectorConfig {
  apiKey: string;
  baseUrl?: string;
  channelId?: string;
  includeShared?: boolean;
}

interface OtterConversation {
  id: string;
  title?: string;
  created_at?: string;
}

interface OtterConversationList {
  data?: OtterConversation[];
  meta?: {
    has_more?: boolean;
    next_cursor?: string | null;
  };
}

interface OtterTranscript {
  content?: string;
  format?: string;
  data?: { content?: string; format?: string } | null;
}

interface OtterConversationDetail {
  data?: OtterConversation & {
    title?: string;
    abstract_summary?: string | null;
    relationships?: {
      transcript?: OtterTranscript | null;
    };
  };
}

export class OtterConnector implements Connector {
  readonly name = "otter";
  constructor(private readonly config: OtterConfig) {}

  private async otterFetch(path: string): Promise<unknown> {
    const base = (this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    const res = await fetch(`${base}${path}`, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`otter ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async fetchSince(since: Date): Promise<IngestInput[]> {
    if (!this.config.enabled) return [];
    const out: IngestInput[] = [];
    let cursor: string | undefined;

    do {
      const params = new URLSearchParams({ limit: "100" });
      if (cursor !== undefined) params.set("cursor", cursor);
      if (this.config.channelId !== undefined) params.set("channel_id", this.config.channelId);
      if (this.config.includeShared !== undefined) {
        params.set("include_shared", String(this.config.includeShared));
      }

      const list = (await this.otterFetch(
        `/conversations?${params.toString()}`,
      )) as OtterConversationList;
      const conversations = list.data ?? [];
      let sawFresh = false;
      for (const conversation of conversations) {
        const listedTimestamp = parseOtterDate(conversation.created_at);
        if (listedTimestamp !== undefined && listedTimestamp < since) continue;
        sawFresh = true;
        const detail = await this.fetchConversation(conversation.id);
        const timestamp = parseOtterDate(detail.data?.created_at ?? conversation.created_at);
        const text = this.conversationText(detail, conversation);
        if (text.trim()) {
          out.push({
            text,
            source: `otter:${conversation.id}`,
            ...(timestamp !== undefined ? { timestamp } : {}),
          });
        }
      }

      if (!sawFresh && conversations.length > 0) break;
      cursor = list.meta?.has_more ? (list.meta.next_cursor ?? undefined) : undefined;
    } while (cursor);

    return out;
  }

  private async fetchConversation(conversationId: string): Promise<OtterConversationDetail> {
    const detail = (await this.otterFetch(
      `/conversations/${encodeURIComponent(conversationId)}?include=transcript`,
    )) as OtterConversationDetail;
    return detail;
  }

  private conversationText(detail: OtterConversationDetail, summary: OtterConversation): string {
    const conversation = detail.data;
    const transcript = conversation?.relationships?.transcript;
    const transcriptContent = transcript?.content ?? transcript?.data?.content ?? "";
    return [conversation?.title ?? summary.title, conversation?.abstract_summary, transcriptContent]
      .filter((part) => part !== undefined && part !== null && part.trim())
      .join("\n\n");
  }
}

function parseOtterDate(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
