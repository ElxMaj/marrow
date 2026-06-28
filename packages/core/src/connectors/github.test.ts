import { afterEach, describe, expect, it, vi } from "vitest";

import { GitHubIssuesConnector } from "./github.js";

describe("GitHubIssuesConnector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disabled config returns no drafts", async () => {
    const connector = new GitHubIssuesConnector({ enabled: false, token: "", repos: [] });
    expect(await connector.fetchSince(new Date("2026-01-01"))).toEqual([]);
    expect(connector.name).toBe("github-issues");
  });

  it("maps an issue to a draft whose timestamp is the issue updated_at", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.includes("/comments")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(
        JSON.stringify([
          {
            number: 7,
            title: "ship soft delete",
            body: "recoverable deletes",
            updated_at: "2026-06-10T12:00:00Z",
            html_url: "https://github.com/acme/app/issues/7",
          },
        ]),
        { status: 200 },
      );
    });

    const connector = new GitHubIssuesConnector({
      enabled: true,
      token: "x",
      repos: [{ owner: "acme", repo: "app" }],
    });
    const drafts = await connector.fetchSince(new Date("2026-01-01"));

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.source).toBe("github:acme/app#7");
    expect(drafts[0]?.timestamp).toEqual(new Date("2026-06-10T12:00:00Z"));
  });

  it("sends GitHub API headers and appends issue comments to the draft text", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = input.toString();
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer ghp_test",
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      });

      if (url.includes("/comments?")) {
        expect(url).toContain("since=2026-01-01T00%3A00%3A00.000Z");
        return new Response(
          JSON.stringify([{ body: "ship without passwords" }, { body: "keep recovery email" }]),
          { status: 200 },
        );
      }

      expect(url).toContain("/repos/acme/app/issues?state=all");
      expect(url).toContain("since=2026-01-01T00%3A00%3A00.000Z");
      return new Response(
        JSON.stringify([
          {
            number: 9,
            title: "login policy",
            body: "magic links only",
            updated_at: "2026-06-10T12:00:00Z",
            html_url: "https://github.com/acme/app/issues/9",
          },
        ]),
        { status: 200 },
      );
    });

    const connector = new GitHubIssuesConnector({
      enabled: true,
      token: "ghp_test",
      repos: [{ owner: "acme", repo: "app" }],
    });
    const drafts = await connector.fetchSince(new Date("2026-01-01T00:00:00Z"));

    expect(drafts[0]?.text).toBe(
      "#9 login policy\n\nmagic links only\n\nship without passwords\n\nkeep recovery email",
    );
  });

  it("paginates issue lists while GitHub returns full pages", async () => {
    const issuePageUrls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.includes("/comments?")) return new Response(JSON.stringify([]), { status: 200 });

      issuePageUrls.push(url);
      const page = new URL(url).searchParams.get("page");
      if (page === "1") {
        return new Response(
          JSON.stringify(
            Array.from({ length: 100 }, (_, index) => ({
              number: index + 1,
              title: `issue ${index + 1}`,
              body: null,
              updated_at: "2026-06-10T12:00:00Z",
              html_url: `https://github.com/acme/app/issues/${index + 1}`,
            })),
          ),
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
    const drafts = await connector.fetchSince(new Date("2026-01-01T00:00:00Z"));

    expect(drafts).toHaveLength(100);
    expect(issuePageUrls.map((url) => new URL(url).searchParams.get("page"))).toEqual(["1", "2"]);
  });

  it("throws loudly when GitHub returns an HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad token", { status: 401 }));

    const connector = new GitHubIssuesConnector({
      enabled: true,
      token: "bad",
      repos: [{ owner: "acme", repo: "app" }],
    });

    await expect(connector.fetchSince(new Date("2026-01-01T00:00:00Z"))).rejects.toThrow(
      "github /repos/acme/app/issues?state=all&since=2026-01-01T00%3A00%3A00.000Z&per_page=100&page=1: 401 bad token",
    );
  });
});
