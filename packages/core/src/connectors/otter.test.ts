import { afterEach, describe, expect, it, vi } from "vitest";

import { OtterConnector } from "./otter.js";

describe("otter connector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disabled connector returns no drafts and never hits the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const connector = new OtterConnector({ enabled: false, apiKey: "" });
    expect(await connector.fetchSince(new Date("2026-01-01"))).toEqual([]);
    expect(connector.name).toBe("otter");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps a conversation detail to a draft with a stable otter:<id> source", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.endsWith("/conversations?limit=100")) {
        return new Response(
          JSON.stringify({
            data: [{ id: "conv_1", title: "Pricing sync", created_at: "2026-06-10T12:00:00Z" }],
            meta: { has_more: false },
          }),
          { status: 200 },
        );
      }
      expect(url).toBe("https://api.otter.ai/v1/conversations/conv_1?include=transcript");
      return new Response(
        JSON.stringify({
          data: {
            id: "conv_1",
            title: "Pricing sync",
            created_at: "2026-06-10T12:00:00Z",
            abstract_summary: "We agreed to drop the free tier.",
            relationships: {
              transcript: {
                content: "Ana 00:00\nWe drop the free tier.\n\nBo 00:08\nAgreed, next quarter.",
                format: "txt",
              },
            },
          },
        }),
        { status: 200 },
      );
    });

    const connector = new OtterConnector({ enabled: true, apiKey: "otk_test" });
    const drafts = await connector.fetchSince(new Date("2026-01-01"));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.source).toBe("otter:conv_1");
    expect(drafts[0]?.text).toBe(
      "Pricing sync\n\nWe agreed to drop the free tier.\n\nAna 00:00\nWe drop the free tier.\n\nBo 00:08\nAgreed, next quarter.",
    );
    expect(drafts[0]?.timestamp).toEqual(new Date("2026-06-10T12:00:00Z"));
  });

  it("passes official query params and bearer auth to the conversations endpoint", async () => {
    const seen: { url: URL; auth: string | null }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      seen.push({
        url: new URL(input.toString()),
        auth: new Headers(init?.headers).get("authorization"),
      });
      return new Response(JSON.stringify({ data: [], meta: { has_more: false } }), { status: 200 });
    });

    const connector = new OtterConnector({
      enabled: true,
      apiKey: "otk_test",
      channelId: "chan_1",
      includeShared: true,
    });
    await connector.fetchSince(new Date("2026-01-01"));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.url.origin).toBe("https://api.otter.ai");
    expect(seen[0]?.url.pathname).toBe("/v1/conversations");
    expect(seen[0]?.url.searchParams.get("limit")).toBe("100");
    expect(seen[0]?.url.searchParams.get("channel_id")).toBe("chan_1");
    expect(seen[0]?.url.searchParams.get("include_shared")).toBe("true");
    expect(seen[0]?.auth).toBe("Bearer otk_test");
  });

  it("follows cursor pagination until meta.has_more is false", async () => {
    let listCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.includes("/conversations?")) {
        listCalls += 1;
        if (!url.includes("cursor=")) {
          return new Response(
            JSON.stringify({
              data: [{ id: "conv_1", title: "one", created_at: "2026-06-10T12:00:00Z" }],
              meta: { has_more: true, next_cursor: "cursor_2" },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            data: [{ id: "conv_2", title: "two", created_at: "2026-06-09T12:00:00Z" }],
            meta: { has_more: false },
          }),
          { status: 200 },
        );
      }
      const id = url.split("/conversations/")[1]?.split("?")[0];
      return new Response(
        JSON.stringify({
          data: {
            id,
            title: id,
            created_at: "2026-06-10T12:00:00Z",
            relationships: { transcript: { content: "X 00:00\nhi", format: "txt" } },
          },
        }),
        { status: 200 },
      );
    });

    const connector = new OtterConnector({ enabled: true, apiKey: "otk_test" });
    const drafts = await connector.fetchSince(new Date("2026-01-01"));
    expect(listCalls).toBe(2);
    expect(drafts.map((d) => d.source)).toEqual(["otter:conv_1", "otter:conv_2"]);
  });

  it("applies the since filter and skips old conversations without fetching detail", async () => {
    const since = new Date("2026-06-01T00:00:00Z");
    const detailIds: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.includes("/conversations?")) {
        return new Response(
          JSON.stringify({
            data: [
              { id: "new", title: "new", created_at: "2026-06-01T00:01:00Z" },
              { id: "old", title: "old", created_at: "2026-05-31T23:59:00Z" },
            ],
            meta: { has_more: false },
          }),
          { status: 200 },
        );
      }
      const id = url.split("/conversations/")[1]?.split("?")[0] ?? "";
      detailIds.push(id);
      return new Response(
        JSON.stringify({
          data: {
            id,
            title: id,
            created_at: "2026-06-01T00:01:00Z",
            relationships: { transcript: { content: "X 00:00\nok", format: "txt" } },
          },
        }),
        { status: 200 },
      );
    });

    const connector = new OtterConnector({ enabled: true, apiKey: "otk_test" });
    const drafts = await connector.fetchSince(since);
    expect(detailIds).toEqual(["new"]);
    expect(drafts.map((d) => d.source)).toEqual(["otter:new"]);
  });

  it("throws a useful error when Otter returns a non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 401 }));

    const connector = new OtterConnector({ enabled: true, apiKey: "bad" });
    await expect(connector.fetchSince(new Date("2026-01-01"))).rejects.toThrow(/otter/i);
  });
});
