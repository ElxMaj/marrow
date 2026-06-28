import { type IngestInput } from "../marrow.js";
import { type Connector, type ConnectorConfig } from "./index.js";

export interface JiraConfig extends ConnectorConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  jql?: string;
  projectKeys?: string[];
}

interface JiraComment {
  author?: { displayName?: string };
  body?: unknown;
}

interface JiraIssue {
  key: string;
  fields: {
    summary?: string;
    description?: unknown;
    updated?: string;
    comment?: { comments?: JiraComment[] };
  };
}

interface JiraSearch {
  startAt?: number;
  maxResults?: number;
  total?: number;
  issues?: JiraIssue[];
}

const PAGE_SIZE = 50;

// jira wants the updated clause as yyyy/MM/dd HH:mm, interpreted in the
// caller's timezone. best-effort using local time; jira widens to the day.
function jiraDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// atlassian document format is a nested tree of nodes. we do not need fidelity,
// just the words: collect every text node, break blocks onto their own lines.
function adfToText(node: unknown): string {
  if (node == null || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (typeof n.text === "string") return n.text;
  const inner = Array.isArray(n.content) ? n.content.map(adfToText).join("") : "";
  if (n.type === "paragraph" || n.type === "heading" || n.type === "listItem") {
    return `${inner}\n`;
  }
  return inner;
}

export class JiraConnector implements Connector {
  readonly name = "jira";
  constructor(private readonly config: JiraConfig) {}

  private buildJql(since: Date): string {
    const clauses = [`updated >= "${jiraDate(since)}"`];
    if (this.config.projectKeys && this.config.projectKeys.length > 0) {
      clauses.push(`project in (${this.config.projectKeys.join(", ")})`);
    }
    if (this.config.jql) clauses.push(`(${this.config.jql})`);
    return clauses.join(" AND ");
  }

  private async jiraFetch(path: string): Promise<unknown> {
    const auth = Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString("base64");
    const res = await fetch(`https://${this.config.baseUrl}/rest/api/3${path}`, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`jira ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  private issueToInput(issue: JiraIssue): IngestInput {
    const summary = issue.fields.summary ?? "";
    const parts = [`Issue ${issue.key}: ${summary}`];

    const desc = adfToText(issue.fields.description).trim();
    if (desc) parts.push(desc);

    const comments = (issue.fields.comment?.comments ?? [])
      .map((c) => `${c.author?.displayName ?? "unknown"}: ${adfToText(c.body).trim()}`)
      .join("\n");
    if (comments) parts.push(`Comments:\n${comments}`);

    return {
      text: parts.join("\n\n"),
      source: `jira:${issue.key}`,
      ...(issue.fields.updated ? { timestamp: new Date(issue.fields.updated) } : {}),
    };
  }

  async fetchSince(since: Date): Promise<IngestInput[]> {
    if (!this.config.enabled) return [];
    const jql = this.buildJql(since);
    const out: IngestInput[] = [];

    let startAt = 0;
    let total = 0;
    do {
      const data = (await this.jiraFetch(
        `/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=${PAGE_SIZE}&fields=summary,description,comment,updated`,
      )) as JiraSearch;
      const issues = data.issues ?? [];
      total = data.total ?? 0;
      for (const issue of issues) out.push(this.issueToInput(issue));
      if (issues.length === 0) break;
      startAt += issues.length;
    } while (startAt < total);

    return out;
  }
}
