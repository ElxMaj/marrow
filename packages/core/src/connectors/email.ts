import { type IngestInput } from "../marrow.js";
import { type Connector, type ConnectorConfig } from "./index.js";

export interface EmailConfig extends ConnectorConfig {
  accessToken: string;
  query?: string;
  labelIds?: string[];
}

interface GmailPart {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  snippet?: string;
  /** epoch millis as a string; the message's source-side receipt time. */
  internalDate?: string;
  payload?: GmailPart;
}

export class EmailConnector implements Connector {
  readonly name = "email";
  constructor(private readonly config: EmailConfig) {}

  private async gmailFetch(path: string): Promise<unknown> {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`gmail ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async fetchSince(since: Date): Promise<IngestInput[]> {
    if (!this.config.enabled) return [];
    const afterSeconds = Math.floor(since.getTime() / 1000);
    const q = [`after:${afterSeconds}`, this.config.query].filter(Boolean).join(" ");
    const labels = (this.config.labelIds ?? [])
      .map((id) => `&labelIds=${encodeURIComponent(id)}`)
      .join("");
    const out: IngestInput[] = [];
    let pageToken: string | undefined;

    do {
      const list = (await this.gmailFetch(
        `/messages?q=${encodeURIComponent(q)}${labels}${pageToken ? `&pageToken=${pageToken}` : ""}`,
      )) as { messages?: { id: string }[]; nextPageToken?: string };

      for (const ref of list.messages ?? []) {
        const msg = (await this.gmailFetch(`/messages/${ref.id}?format=full`)) as GmailMessage;
        const subject = this.header(msg.payload, "Subject") ?? "(no subject)";
        const body = this.plainTextBody(msg.payload) ?? msg.snippet ?? "";
        out.push({
          text: `Subject: ${subject}\n\n${body}`,
          source: `email:${ref.id}`,
          ...(msg.internalDate ? { timestamp: new Date(Number(msg.internalDate)) } : {}),
        });
      }
      pageToken = list.nextPageToken;
    } while (pageToken);

    return out;
  }

  private header(part: GmailPart | undefined, name: string): string | undefined {
    return part?.headers?.find((h) => h.name === name)?.value;
  }

  // gmail nests the text/plain part inside payload.parts (and sometimes deeper
  // for multipart bodies), so walk the tree and decode the first match.
  private plainTextBody(part: GmailPart | undefined): string | undefined {
    if (!part) return undefined;
    if (part.mimeType === "text/plain" && part.body?.data) {
      return Buffer.from(part.body.data, "base64url").toString("utf-8");
    }
    for (const child of part.parts ?? []) {
      const found = this.plainTextBody(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }
}
