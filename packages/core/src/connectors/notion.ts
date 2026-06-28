import { type IngestInput } from "../marrow.js";
import { type Connector, type ConnectorConfig } from "./index.js";

export interface NotionConfig extends ConnectorConfig {
  token: string;
  pageIds?: string[];
  databaseIds?: string[];
}

interface NotionPage {
  id: string;
  url: string;
  last_edited_time: string;
}

interface NotionBlock {
  id?: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}

function textFromBlock(block: NotionBlock): string {
  const rich = (block[block.type] as { rich_text?: { plain_text?: string }[] } | undefined)
    ?.rich_text;
  return (rich ?? []).map((t) => t.plain_text ?? "").join("");
}

export class NotionConnector implements Connector {
  readonly name = "notion";
  constructor(private readonly config: NotionConfig) {}

  private async notionFetch(path: string, init?: RequestInit): Promise<unknown> {
    const res = await fetch(`https://api.notion.com/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    if (!res.ok) throw new Error(`notion ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  private async searchPages(since: Date): Promise<{ id: string; lastEdited?: string }[]> {
    if ((this.config.pageIds?.length ?? 0) > 0) {
      // configured ids carry no edit time; the watermark falls back to wall clock
      return (this.config.pageIds ?? []).map((id) => ({ id }));
    }
    const pages: { id: string; lastEdited?: string }[] = [];
    let cursor: string | undefined;
    do {
      const data = (await this.notionFetch("/search", {
        method: "POST",
        body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
      })) as { results?: NotionPage[]; next_cursor?: string | null };
      for (const page of data.results ?? []) {
        if (new Date(page.last_edited_time) >= since) {
          pages.push({ id: page.id, lastEdited: page.last_edited_time });
        }
      }
      cursor = data.next_cursor ?? undefined;
    } while (cursor);
    return pages;
  }

  private async fetchBlockTexts(blockId: string): Promise<string[]> {
    const parts: string[] = [];
    let cursor: string | undefined;
    do {
      const data = (await this.notionFetch(
        `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`,
      )) as { results?: NotionBlock[]; next_cursor?: string | null };
      for (const block of data.results ?? []) {
        const text = textFromBlock(block);
        if (text) parts.push(text);
        if (block.has_children && block.id) {
          parts.push(...(await this.fetchBlockTexts(block.id)));
        }
      }
      cursor = data.next_cursor ?? undefined;
    } while (cursor);
    return parts;
  }

  private async fetchPageText(pageId: string): Promise<string> {
    const parts = await this.fetchBlockTexts(pageId);
    return parts.join("\n");
  }

  async fetchSince(since: Date): Promise<IngestInput[]> {
    if (!this.config.enabled) return [];
    const pages = await this.searchPages(since);
    const out: IngestInput[] = [];
    for (const page of pages) {
      const text = await this.fetchPageText(page.id);
      if (text.trim()) {
        out.push({
          text,
          source: `notion:${page.id}`,
          ...(page.lastEdited ? { timestamp: new Date(page.lastEdited) } : {}),
        });
      }
    }
    return out;
  }
}
