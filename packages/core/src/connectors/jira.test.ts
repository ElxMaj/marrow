import { afterEach, describe, expect, it, vi } from "vitest";

import { JiraConnector } from "./jira.js";

// a minimal atlassian doc node so we exercise the adf -> plain text walk.
function adf(text: string) {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

function issue(key: string, summary: string, desc: string) {
  return {
    key,
    fields: {
      summary,
      description: adf(desc),
      updated: "2026-06-10T12:00:00.000Z",
      comment: {
        comments: [{ author: { displayName: "Dana" }, body: adf("looks good") }],
      },
    },
  };
}

function jqlOf(url: unknown): string {
  return new URL(String(url)).searchParams.get("jql") ?? "";
}

describe("JiraConnector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disabled config returns no drafts", async () => {
    const connector = new JiraConnector({
      enabled: false,
      baseUrl: "acme.atlassian.net",
      email: "",
      apiToken: "",
    });
    expect(await connector.fetchSince(new Date("2026-01-01"))).toEqual([]);
    expect(connector.name).toBe("jira");
  });

  it("maps a jira issue to a shaped draft with a stable source and basic auth", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          startAt: 0,
          maxResults: 50,
          total: 1,
          issues: [issue("PROJ-1", "ship soft delete", "we need recoverable deletes")],
        }),
        { status: 200 },
      ),
    );
    const connector = new JiraConnector({
      enabled: true,
      baseUrl: "acme.atlassian.net",
      email: "dev@acme.io",
      apiToken: "tok",
    });

    const drafts = await connector.fetchSince(new Date("2026-01-01"));

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.source).toBe("jira:PROJ-1");
    expect(drafts[0]?.text).toContain("Issue PROJ-1: ship soft delete");
    expect(drafts[0]?.text).toContain("we need recoverable deletes");
    expect(drafts[0]?.text).toContain("Comments:");
    expect(drafts[0]?.text).toContain("Dana: looks good");
    // the draft carries the issue's source-side updated time as the watermark
    expect(drafts[0]?.timestamp).toEqual(new Date("2026-06-10T12:00:00.000Z"));

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toContain("https://acme.atlassian.net/rest/api/3/search");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("dev@acme.io:tok").toString("base64")}`,
    );
  });

  it("omits the comments block when an issue has no comments", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          startAt: 0,
          maxResults: 50,
          total: 1,
          issues: [
            {
              key: "PROJ-2",
              fields: {
                summary: "no comments yet",
                description: adf("plain description"),
                updated: "2026-06-10T12:00:00.000Z",
                comment: { comments: [] },
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const connector = new JiraConnector({
      enabled: true,
      baseUrl: "acme.atlassian.net",
      email: "dev@acme.io",
      apiToken: "tok",
    });

    const drafts = await connector.fetchSince(new Date("2026-01-01"));

    expect(drafts[0]?.text).toContain("Issue PROJ-2: no comments yet");
    expect(drafts[0]?.text).toContain("plain description");
    expect(drafts[0]?.text).not.toContain("Comments:");
  });

  it("follows startAt/maxResults pagination", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const startAt = Number(new URL(String(input)).searchParams.get("startAt"));
      if (startAt === 0) {
        return new Response(
          JSON.stringify({
            startAt: 0,
            maxResults: 1,
            total: 2,
            issues: [issue("PROJ-1", "first", "a")],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          startAt: 1,
          maxResults: 1,
          total: 2,
          issues: [issue("PROJ-2", "second", "b")],
        }),
        { status: 200 },
      );
    });
    const connector = new JiraConnector({
      enabled: true,
      baseUrl: "acme.atlassian.net",
      email: "x",
      apiToken: "y",
    });

    const drafts = await connector.fetchSince(new Date("2026-01-01"));

    expect(drafts.map((d) => d.source)).toEqual(["jira:PROJ-1", "jira:PROJ-2"]);
  });

  it("applies the since filter and project keys in the jql", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ startAt: 0, maxResults: 50, total: 0, issues: [] }), {
        status: 200,
      }),
    );
    const connector = new JiraConnector({
      enabled: true,
      baseUrl: "acme.atlassian.net",
      email: "x",
      apiToken: "y",
      projectKeys: ["PROJ", "OPS"],
    });

    await connector.fetchSince(new Date("2026-01-02T03:04:00"));

    const jql = jqlOf(fetchSpy.mock.calls[0]?.[0]);
    expect(jql).toMatch(/^updated >= "/);
    expect(jql).toContain("project in (PROJ, OPS)");
  });
});
