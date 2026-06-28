import { afterEach, describe, expect, it, vi } from "vitest";

import { TeamsConnector } from "./teams.js";

describe("teams connector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disabled config returns empty drafts", async () => {
    const connector = new TeamsConnector({
      enabled: false,
      accessToken: "",
      teamId: "T1",
    });
    const drafts = await connector.fetchSince(new Date("2026-01-01"));
    expect(drafts).toEqual([]);
    expect(connector.name).toBe("teams");
  });

  it("lists channels, maps messages, follows pagination, applies since, strips html, skips system messages", async () => {
    const since = new Date("2026-01-01T00:00:00Z");
    const page2 = "https://graph.microsoft.com/v1.0/teams/T1/channels/C1/messages?$skiptoken=abc";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      // channel listing (channelIds absent)
      if (url.endsWith("/teams/T1/channels")) {
        return new Response(JSON.stringify({ value: [{ id: "C1" }] }), { status: 200 });
      }
      // second page reached only by following @odata.nextLink
      if (url === page2) {
        return new Response(
          JSON.stringify({
            value: [
              {
                id: "m-old",
                messageType: "message",
                createdDateTime: "2025-12-01T00:00:00Z",
                lastModifiedDateTime: "2025-12-01T00:00:00Z",
                body: { contentType: "html", content: "<p>too old</p>" },
              },
              {
                id: "m-sys",
                messageType: "systemEventMessage",
                createdDateTime: "2026-03-01T00:00:00Z",
                body: { contentType: "html", content: "<systemEventMessage/>" },
              },
              {
                id: "m-missing-type",
                createdDateTime: "2026-03-01T00:00:00Z",
                body: { contentType: "html", content: "<p>ambiguous event</p>" },
              },
            ],
          }),
          { status: 200 },
        );
      }
      // first page of channel messages
      if (url.endsWith("/teams/T1/channels/C1/messages")) {
        return new Response(
          JSON.stringify({
            "@odata.nextLink": page2,
            value: [
              {
                id: "m1",
                messageType: "message",
                createdDateTime: "2026-02-01T00:00:00Z",
                lastModifiedDateTime: "2026-02-02T00:00:00Z",
                body: { contentType: "html", content: "<p>let's <b>ship</b> it</p>" },
              },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected url ${url}`);
    });

    const connector = new TeamsConnector({
      enabled: true,
      accessToken: "tok",
      teamId: "T1",
    });
    const drafts = await connector.fetchSince(since);

    // only the in-window, real message survives; old + system are dropped
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.text).toBe("let's ship it");
    // stable unique source: team, channel, message id
    expect(drafts[0]?.source).toBe("teams:T1:C1:m1");
    // watermark comes from lastModifiedDateTime (preferred over createdDateTime)
    expect(drafts[0]?.timestamp).toEqual(new Date("2026-02-02T00:00:00Z"));

    // bearer auth on the listing call
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://graph.microsoft.com/v1.0/teams/T1/channels",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
      }),
    );
    // pagination: the nextLink page was actually fetched
    expect(fetchSpy).toHaveBeenCalledWith(page2, expect.anything());
  });

  it("uses configured channelIds and skips channel listing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          value: [
            {
              id: "m9",
              messageType: "message",
              createdDateTime: "2026-05-01T00:00:00Z",
              body: { contentType: "html", content: "hello" },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const connector = new TeamsConnector({
      enabled: true,
      accessToken: "tok",
      teamId: "T1",
      channelIds: ["C9"],
    });
    const drafts = await connector.fetchSince(new Date("2026-01-01"));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.source).toBe("teams:T1:C9:m9");

    const calls = fetchSpy.mock.calls.map((c) => c[0]?.toString());
    expect(calls.some((u) => u?.endsWith("/teams/T1/channels"))).toBe(false);
  });
});
