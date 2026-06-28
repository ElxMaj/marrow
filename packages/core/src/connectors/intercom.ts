import { type IngestInput } from "../marrow.js";
import { type Connector, type ConnectorConfig } from "./index.js";

export interface IntercomConfig extends ConnectorConfig {
  token: string;
}

interface IntercomConversation {
  id: string;
  updated_at: number;
}

interface IntercomConversationDetail {
  source?: {
    author?: { name?: string; type?: string };
    body?: string;
    created_at?: number;
  };
  conversation_parts?: {
    conversation_parts: {
      author?: { name?: string; type?: string };
      body?: string;
      created_at: number;
    }[];
  };
}

export class IntercomConnector implements Connector {
  readonly name = "intercom";
  constructor(private readonly config: IntercomConfig) {}

  private async intercomFetch(path: string): Promise<unknown> {
    const res = await fetch(`https://api.intercom.io${path}`, {
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`intercom ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async fetchSince(since: Date): Promise<IngestInput[]> {
    if (!this.config.enabled) return [];
    const sinceSeconds = Math.floor(since.getTime() / 1000);
    const out: IngestInput[] = [];
    let startingAfter: string | undefined;

    do {
      const data = (await this.intercomFetch(
        `/conversations?sort=updated_at&order=desc${startingAfter ? `&starting_after=${startingAfter}` : ""}`,
      )) as {
        conversations?: IntercomConversation[];
        pages?: { next?: { starting_after?: string } };
      };
      const conversations = data.conversations ?? [];
      for (const conversation of conversations) {
        if (conversation.updated_at < sinceSeconds) return out;
        const detail = (await this.intercomFetch(
          `/conversations/${conversation.id}`,
        )) as IntercomConversationDetail;
        const source = detail.source ? [detail.source] : [];
        const parts = [...source, ...(detail.conversation_parts?.conversation_parts ?? [])];
        const text = parts
          .filter((p) => p.author?.type === "admin")
          .map((p) => `${p.author?.name ?? "admin"}: ${p.body ?? ""}`)
          .join("\n\n");
        if (text.trim()) {
          out.push({
            text,
            source: `intercom:${conversation.id}`,
            timestamp: new Date(conversation.updated_at * 1000),
          });
        }
      }
      startingAfter = data.pages?.next?.starting_after;
    } while (startingAfter);

    return out;
  }
}
