import { type IngestInput } from "../marrow.js";
import { type Connector, type ConnectorConfig } from "./index.js";

export interface LinearConfig extends ConnectorConfig {
  token: string;
  teamIds?: string[];
}

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  updatedAt: string;
}

export class LinearConnector implements Connector {
  readonly name = "linear";
  constructor(private readonly config: LinearConfig) {}

  private async linearGraphQL(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<unknown> {
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        Authorization: this.config.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`linear: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { data?: unknown; errors?: unknown[] };
    if (data.errors) throw new Error(`linear: ${JSON.stringify(data.errors)}`);
    return data.data;
  }

  async fetchSince(since: Date): Promise<IngestInput[]> {
    if (!this.config.enabled) return [];
    // Filter on updatedAt server-side and order by updatedAt, then page through
    // every result. Without this, a default page of 100 in the default order
    // silently dropped issues updated since the cursor that sit past page 1
    // (F-CORE-054).
    const filter: Record<string, unknown> = { updatedAt: { gte: since.toISOString() } };
    if (this.config.teamIds) filter.team = { id: { in: this.config.teamIds } };

    const query = `
      query Issues($filter: IssueFilter, $after: String) {
        issues(first: 100, after: $after, filter: $filter, orderBy: updatedAt) {
          nodes { id identifier title description updatedAt }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    const out: IngestInput[] = [];
    let after: string | undefined;
    for (;;) {
      const data = (await this.linearGraphQL(query, { filter, after })) as {
        issues?: {
          nodes?: LinearIssue[];
          pageInfo?: { hasNextPage: boolean; endCursor?: string | null };
        };
      };
      for (const issue of data.issues?.nodes ?? []) {
        const text = [`${issue.identifier}: ${issue.title}`, issue.description ?? ""].join("\n\n");
        out.push({
          text,
          source: `linear:${issue.identifier}`,
          timestamp: new Date(issue.updatedAt),
        });
      }
      const pageInfo = data.issues?.pageInfo;
      if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
      after = pageInfo.endCursor;
    }
    return out;
  }
}
