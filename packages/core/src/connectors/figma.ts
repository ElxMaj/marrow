import { type IngestInput } from "../marrow.js";
import { type Connector, type ConnectorConfig } from "./index.js";

export interface FigmaConfig extends ConnectorConfig {
  token: string;
  fileKeys?: string[];
}

interface FigmaComment {
  id: string;
  message: string;
  created_at: string;
  file_key: string;
}

export class FigmaConnector implements Connector {
  readonly name = "figma";
  constructor(private readonly config: FigmaConfig) {}

  private async figmaFetch(path: string): Promise<unknown> {
    const res = await fetch(`https://api.figma.com/v1${path}`, {
      headers: { "X-Figma-Token": this.config.token },
    });
    if (!res.ok) throw new Error(`figma ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async fetchSince(since: Date): Promise<IngestInput[]> {
    if (!this.config.enabled || (this.config.fileKeys?.length ?? 0) === 0) return [];
    const out: IngestInput[] = [];
    for (const fileKey of this.config.fileKeys ?? []) {
      const data = (await this.figmaFetch(`/files/${fileKey}/comments`)) as {
        comments?: FigmaComment[];
      };
      for (const comment of data.comments ?? []) {
        if (new Date(comment.created_at) >= since) {
          out.push({
            text: comment.message,
            source: `figma:${fileKey}:${comment.id}`,
            timestamp: new Date(comment.created_at),
          });
        }
      }
    }
    return out;
  }
}
