import { type IngestInput } from "../marrow.js";
import { type Connector, type ConnectorConfig } from "./index.js";

export interface GranolaConfig extends ConnectorConfig {
  apiToken: string;
  /** override for the granola api host. defaults to the public host. */
  baseUrl?: string;
  /** scope the pull to one Granola folder and its child folders when set. */
  folderId?: string;
}

interface GranolaNoteSummary {
  id: string;
  title?: string | null;
  /** iso 8601 timestamp of the last edit. */
  updated_at: string;
}

interface GranolaNotesPage {
  notes: GranolaNoteSummary[];
  hasMore: boolean;
  cursor: string | null;
}

interface GranolaTranscriptSegment {
  speaker?: {
    source?: string;
    diarization_label?: string | null;
  };
  text?: string;
}

interface GranolaNoteDetail extends GranolaNoteSummary {
  summary_text?: string;
  summary_markdown?: string | null;
  transcript?: GranolaTranscriptSegment[] | null;
}

const DEFAULT_BASE_URL = "https://public-api.granola.ai";

export class GranolaConnector implements Connector {
  readonly name = "granola";
  constructor(private readonly config: GranolaConfig) {}

  private async granolaFetch(path: string): Promise<unknown> {
    const baseUrl = (this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    const res = await fetch(`${baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${this.config.apiToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`granola ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async fetchSince(since: Date): Promise<IngestInput[]> {
    if (!this.config.enabled) return [];
    const out: IngestInput[] = [];
    let cursor: string | undefined;

    do {
      const params = new URLSearchParams({ updated_after: since.toISOString(), page_size: "30" });
      if (this.config.folderId) params.set("folder_id", this.config.folderId);
      if (cursor) params.set("cursor", cursor);

      const page = (await this.granolaFetch(`/v1/notes?${params.toString()}`)) as GranolaNotesPage;
      for (const note of page.notes ?? []) {
        // belt and suspenders: also filter client-side so a server that ignores
        // updated_after cannot leak stale notes past the watermark.
        if (new Date(note.updated_at) < since) continue;

        const detail = await this.fetchNote(note.id);
        const timestamp = new Date(detail.updated_at ?? note.updated_at);
        if (timestamp < since) continue;

        const text = this.noteText(detail, note);
        if (text.trim()) out.push({ text, source: `granola:${note.id}`, timestamp });
      }
      cursor = page.hasMore ? (page.cursor ?? undefined) : undefined;
    } while (cursor);

    return out;
  }

  private async fetchNote(noteId: string): Promise<GranolaNoteDetail> {
    return (await this.granolaFetch(
      `/v1/notes/${encodeURIComponent(noteId)}?include=transcript`,
    )) as GranolaNoteDetail;
  }

  private noteText(detail: GranolaNoteDetail, summary: GranolaNoteSummary): string {
    const title = detail.title ?? summary.title ?? "";
    const body = detail.summary_markdown ?? detail.summary_text ?? "";
    const transcript = (detail.transcript ?? [])
      .map((segment) => {
        const speaker = segment.speaker?.diarization_label ?? segment.speaker?.source ?? "Unknown";
        return `${speaker}: ${segment.text ?? ""}`;
      })
      .filter((line) => !line.endsWith(": "))
      .join("\n");
    return [title, body, transcript].filter((part) => part.trim()).join("\n\n");
  }
}
