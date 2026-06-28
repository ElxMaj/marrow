import { afterEach, describe, expect, it, vi } from "vitest";

import { SlackConnector } from "./slack.js";

describe("SlackConnector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disabled config returns no drafts", async () => {
    const connector = new SlackConnector({ enabled: false, botToken: "" });
    expect(await connector.fetchSince(new Date("2026-01-01"))).toEqual([]);
    expect(connector.name).toBe("slack");
  });

  it("maps a message to a draft whose timestamp is msg.ts in millis", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.includes("conversations.history")) {
        return new Response(
          JSON.stringify({
            ok: true,
            messages: [{ ts: "1780000000.000200", text: "we ship monday" }],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const connector = new SlackConnector({ enabled: true, botToken: "x", channelIds: ["C1"] });
    const drafts = await connector.fetchSince(new Date("2026-01-01"));

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.source).toBe("slack:C1:1780000000.000200");
    // slack ts is epoch seconds; the watermark is that time in millis
    expect(drafts[0]?.timestamp).toEqual(new Date(1780000000.0002 * 1000));
  });

  it("resolves public channels, authenticates, filters by oldest, and follows encoded cursors", async () => {
    const since = new Date("2026-01-01T00:00:00Z");
    const calls: string[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = input.toString();
      calls.push(url);
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer xoxb-test",
        "Content-Type": "application/json; charset=utf-8",
      });

      if (url.includes("conversations.list")) {
        return new Response(JSON.stringify({ ok: true, channels: [{ id: "C1" }, { id: "C2" }] }), {
          status: 200,
        });
      }

      expect(url).toContain("oldest=1767225600");
      if (url.includes("channel=C1") && !url.includes("cursor=")) {
        return new Response(
          JSON.stringify({
            ok: true,
            messages: [{ ts: "1780000000.000200", text: "first page" }],
            response_metadata: { next_cursor: "c+2=" },
          }),
          { status: 200 },
        );
      }

      if (url.includes("channel=C1") && url.includes("cursor=c%2B2%3D")) {
        return new Response(
          JSON.stringify({
            ok: true,
            messages: [{ ts: "1780000001.000200", text: "second page" }],
          }),
          { status: 200 },
        );
      }

      if (url.includes("channel=C2")) {
        return new Response(JSON.stringify({ ok: true, messages: [{ ts: "1780000002.000200" }] }), {
          status: 200,
        });
      }

      throw new Error(`unexpected Slack URL ${url}`);
    });

    const connector = new SlackConnector({ enabled: true, botToken: "xoxb-test" });
    const drafts = await connector.fetchSince(since);

    expect(drafts.map((draft) => draft.source)).toEqual([
      "slack:C1:1780000000.000200",
      "slack:C1:1780000001.000200",
    ]);
    expect(calls).toContain("https://slack.com/api/conversations.list?types=public_channel");
    expect(calls.some((url) => url.includes("cursor=c%2B2%3D"))).toBe(true);
  });

  it("throws loudly when Slack returns an API error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "invalid_auth" }), { status: 200 }),
    );

    const connector = new SlackConnector({ enabled: true, botToken: "bad", channelIds: ["C1"] });

    await expect(connector.fetchSince(new Date("2026-01-01T00:00:00Z"))).rejects.toThrow(
      "slack /conversations.history?channel=C1&oldest=1767225600: invalid_auth",
    );
  });
});
