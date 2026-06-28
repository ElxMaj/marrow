import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FigmaConnector,
  GitHubIssuesConnector,
  IntercomConnector,
  LinearConnector,
  NotionConnector,
  SlackConnector,
  ZoomConnector,
} from "./index.js";

describe("connectors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disabled connectors return empty drafts", async () => {
    const since = new Date("2026-01-01");
    const connectors = [
      new LinearConnector({ enabled: false, token: "" }),
      new NotionConnector({ enabled: false, token: "" }),
      new GitHubIssuesConnector({ enabled: false, token: "", repos: [] }),
      new SlackConnector({ enabled: false, botToken: "" }),
      new FigmaConnector({ enabled: false, token: "" }),
      new IntercomConnector({ enabled: false, token: "" }),
      new ZoomConnector({ enabled: false, accountId: "", clientId: "", clientSecret: "" }),
    ];
    for (const c of connectors) {
      const drafts = await c.fetchSince(since);
      expect(drafts).toEqual([]);
      expect(typeof c.name).toBe("string");
    }
  });

  it("slack maps channel messages to ingest drafts", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          messages: [{ ts: "123.456", text: "let's ship it" }],
        }),
        { status: 200 },
      ),
    );
    const connector = new SlackConnector({
      enabled: true,
      botToken: "xoxb-test",
      channelIds: ["C1"],
    });
    const drafts = await connector.fetchSince(new Date("2026-01-01"));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.text).toBe("let's ship it");
    expect(drafts[0]?.source).toBe("slack:C1:123.456");
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/conversations.history"),
      expect.anything(),
    );
  });

  it("github maps issues to ingest drafts", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.includes("/issues?")) {
        return new Response(
          JSON.stringify([
            { number: 1, title: "auth", body: "magic links", updated_at: "2026-06-01T00:00:00Z" },
          ]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const connector = new GitHubIssuesConnector({
      enabled: true,
      token: "ghp_test",
      repos: [{ owner: "acme", repo: "app" }],
    });
    const drafts = await connector.fetchSince(new Date("2026-01-01"));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.source).toBe("github:acme/app#1");
  });
});
