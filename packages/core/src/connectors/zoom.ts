import { type IngestInput } from "../marrow.js";
import { type Connector, type ConnectorConfig } from "./index.js";

export interface ZoomConfig extends ConnectorConfig {
  accountId: string;
  clientId: string;
  clientSecret: string;
}

interface ZoomRecording {
  uuid: string;
  id: string;
  topic: string;
  start_time: string;
  recording_files?: {
    id: string;
    file_type: string;
    download_url: string;
  }[];
}

interface ZoomRecordingsPage {
  meetings?: ZoomRecording[];
  next_page_token?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;

export class ZoomConnector implements Connector {
  readonly name = "zoom";
  private accessToken: string | undefined;

  constructor(private readonly config: ZoomConfig) {}

  private async getToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;
    const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      "base64",
    );
    const res = await fetch(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${this.config.accountId}`,
      {
        method: "POST",
        headers: { Authorization: `Basic ${credentials}` },
      },
    );
    if (!res.ok) throw new Error(`zoom token: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { access_token: string };
    this.accessToken = data.access_token;
    return this.accessToken;
  }

  private async bearerFetch(url: string): Promise<Response> {
    const token = await this.getToken();
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status !== 401) return res;
    this.accessToken = undefined;
    const freshToken = await this.getToken();
    return fetch(url, {
      headers: { Authorization: `Bearer ${freshToken}` },
    });
  }

  private async zoomFetch(path: string): Promise<unknown> {
    const res = await this.bearerFetch(`https://api.zoom.us/v2${path}`);
    if (!res.ok) throw new Error(`zoom ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async fetchSince(since: Date): Promise<IngestInput[]> {
    if (!this.config.enabled) return [];
    const out: IngestInput[] = [];
    for (const window of recordingWindows(since, new Date())) {
      let nextPageToken: string | undefined;
      do {
        const params = new URLSearchParams({
          from: window.from,
          to: window.to,
          page_size: "300",
        });
        if (nextPageToken) params.set("next_page_token", nextPageToken);
        const data = (await this.zoomFetch(
          `/users/me/recordings?${params.toString()}`,
        )) as ZoomRecordingsPage;
        for (const meeting of data.meetings ?? []) {
          const transcriptFile = meeting.recording_files?.find((f) => f.file_type === "TRANSCRIPT");
          if (!transcriptFile) {
            out.push({
              text: `Zoom meeting: ${meeting.topic}`,
              source: `zoom:${meeting.id}`,
              ...(meeting.start_time ? { timestamp: new Date(meeting.start_time) } : {}),
            });
            continue;
          }
          const text = await this.downloadTranscript(transcriptFile.download_url);
          out.push({
            text,
            source: `zoom:${meeting.id}:${transcriptFile.id}`,
            ...(meeting.start_time ? { timestamp: new Date(meeting.start_time) } : {}),
          });
        }
        nextPageToken =
          typeof data.next_page_token === "string" && data.next_page_token.trim().length > 0
            ? data.next_page_token
            : undefined;
      } while (nextPageToken);
    }
    return out;
  }

  private async downloadTranscript(url: string): Promise<string> {
    const res = await this.bearerFetch(url);
    if (!res.ok) throw new Error(`zoom download: ${res.status}`);
    return res.text();
  }
}

function recordingWindows(since: Date, now: Date): { from: string; to: string }[] {
  const end = startOfUtcDay(now);
  let cursor = startOfUtcDay(since);
  const windows: { from: string; to: string }[] = [];
  while (cursor.getTime() <= end.getTime()) {
    const latest = addDays(cursor, WINDOW_DAYS - 1);
    const windowEnd = latest.getTime() < end.getTime() ? latest : end;
    windows.push({ from: dateOnly(cursor), to: dateOnly(windowEnd) });
    cursor = addDays(windowEnd, 1);
  }
  return windows;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function dateOnly(date: Date): string {
  return date.toISOString().split("T")[0] ?? "";
}
