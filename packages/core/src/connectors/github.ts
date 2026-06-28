import { type IngestInput } from "../marrow.js";
import { type Connector, type ConnectorConfig } from "./index.js";

export interface GitHubConfig extends ConnectorConfig {
  token: string;
  repos: { owner: string; repo: string }[];
}

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  updated_at: string;
  html_url: string;
}

interface GitHubComment {
  body: string;
  updated_at: string;
}

export class GitHubIssuesConnector implements Connector {
  readonly name = "github-issues";
  constructor(private readonly config: GitHubConfig) {}

  private async githubFetch(path: string): Promise<unknown> {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) throw new Error(`github ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async fetchSince(since: Date): Promise<IngestInput[]> {
    if (!this.config.enabled) return [];
    const sinceIso = since.toISOString();
    const out: IngestInput[] = [];

    for (const { owner, repo } of this.config.repos) {
      let page = 1;
      let fetched: GitHubIssue[];
      do {
        fetched = (await this.githubFetch(
          `/repos/${owner}/${repo}/issues?state=all&since=${encodeURIComponent(sinceIso)}&per_page=100&page=${page}`,
        )) as GitHubIssue[];
        for (const issue of fetched) {
          const parts: string[] = [`#${issue.number} ${issue.title}`];
          if (issue.body) parts.push(issue.body);

          const comments = (await this.githubFetch(
            `/repos/${owner}/${repo}/issues/${issue.number}/comments?since=${encodeURIComponent(sinceIso)}`,
          )) as GitHubComment[];
          for (const comment of comments) parts.push(comment.body);

          out.push({
            text: parts.join("\n\n"),
            source: `github:${owner}/${repo}#${issue.number}`,
            timestamp: new Date(issue.updated_at),
          });
        }
        page++;
      } while (fetched.length === 100);
    }

    return out;
  }
}
