import { afterEach, describe, expect, it, vi } from "vitest";

import { GranolaConnector } from "./granola.js";

describe("granola connector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disabled config returns no drafts and never calls fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const connector = new GranolaConnector({ enabled: false, apiToken: "" });
    const drafts = await connector.fetchSince(new Date("2026-01-01"));
    expect(drafts).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(connector.name).toBe("granola");
  });

  it("maps a meeting note detail to an ingest draft with a stable source", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.includes("/v1/notes?")) {
        return new Response(
          JSON.stringify({
            notes: [
              {
                id: "not_1d3tmYTlCICgjy",
                title: "Pricing sync",
                updated_at: "2026-06-10T12:00:00Z",
              },
            ],
            hasMore: false,
            cursor: null,
          }),
          { status: 200 },
        );
      }

      expect(url).toContain("/v1/notes/not_1d3tmYTlCICgjy?include=transcript");
      return new Response(
        JSON.stringify({
          id: "not_1d3tmYTlCICgjy",
          title: "Pricing sync",
          summary_markdown: "we agreed to drop the free tier",
          updated_at: "2026-06-10T12:00:00Z",
          transcript: [
            { speaker: { diarization_label: "Ana" }, text: "free tier is gone" },
            { speaker: { source: "speaker" }, text: "agreed" },
          ],
        }),
        { status: 200 },
      );
    });
    const connector = new GranolaConnector({ enabled: true, apiToken: "gr_test" });
    const drafts = await connector.fetchSince(new Date("2026-01-01"));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.text).toBe(
      "Pricing sync\n\nwe agreed to drop the free tier\n\nAna: free tier is gone\nspeaker: agreed",
    );
    expect(drafts[0]?.source).toBe("granola:not_1d3tmYTlCICgjy");
    // watermark comes from the note's iso updated_at
    expect(drafts[0]?.timestamp).toEqual(new Date("2026-06-10T12:00:00Z"));
  });

  it("sends bearer auth and hits the documented notes endpoint on the default base url", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ notes: [], hasMore: false, cursor: null }), { status: 200 }),
      );
    const connector = new GranolaConnector({
      enabled: true,
      apiToken: "gr_secret",
      folderId: "fol_4y6LduVdwSKC27",
    });
    await connector.fetchSince(new Date("2026-01-01T00:00:00Z"));
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    const parsed = new URL(url?.toString() ?? "");
    expect(`${parsed.origin}${parsed.pathname}`).toBe("https://public-api.granola.ai/v1/notes");
    expect(parsed.searchParams.get("updated_after")).toBe("2026-01-01T00:00:00.000Z");
    expect(parsed.searchParams.get("page_size")).toBe("30");
    expect(parsed.searchParams.get("folder_id")).toBe("fol_4y6LduVdwSKC27");
    expect(
      (init as RequestInit | undefined)?.headers as Record<string, string> | undefined,
    ).toMatchObject({
      Authorization: "Bearer gr_secret",
    });
  });

  it("follows pagination until there is no next page token", async () => {
    let call = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (!url.includes("/v1/notes?")) {
        const id = url.split("/v1/notes/")[1]?.split("?")[0];
        return new Response(
          JSON.stringify({
            id,
            title: id,
            summary_text: id,
            updated_at: id === "p1" ? "2026-06-01T00:00:00Z" : "2026-06-02T00:00:00Z",
            transcript: null,
          }),
          { status: 200 },
        );
      }

      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({
            notes: [{ id: "p1", title: "one", updated_at: "2026-06-01T00:00:00Z" }],
            hasMore: true,
            cursor: "cursor-2",
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          notes: [{ id: "p2", title: "two", updated_at: "2026-06-02T00:00:00Z" }],
          hasMore: false,
          cursor: null,
        }),
        { status: 200 },
      );
    });
    const connector = new GranolaConnector({ enabled: true, apiToken: "gr_test" });
    const drafts = await connector.fetchSince(new Date("2026-01-01"));
    expect(
      fetchSpy.mock.calls.filter((entry) => entry[0]?.toString().includes("/v1/notes?")),
    ).toHaveLength(2);
    expect(drafts.map((d) => d.source)).toEqual(["granola:p1", "granola:p2"]);
    // the second request carried the cursor from the first response.
    expect(
      fetchSpy.mock.calls.some((entry) => entry[0]?.toString().includes("cursor=cursor-2")),
    ).toBe(true);
  });

  it("applies the since filter and drops notes updated before it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.includes("/v1/notes?")) {
        return new Response(
          JSON.stringify({
            notes: [
              { id: "new", title: "kept", updated_at: "2026-06-10T00:00:00Z" },
              { id: "old", title: "dropped", updated_at: "2025-12-31T00:00:00Z" },
            ],
            hasMore: false,
            cursor: null,
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          id: "new",
          title: "kept",
          summary_text: "recent",
          updated_at: "2026-06-10T00:00:00Z",
          transcript: null,
        }),
        { status: 200 },
      );
    });
    const connector = new GranolaConnector({ enabled: true, apiToken: "gr_test" });
    const drafts = await connector.fetchSince(new Date("2026-01-01"));
    expect(drafts.map((d) => d.source)).toEqual(["granola:new"]);
    expect(fetchSpy.mock.calls.some((entry) => entry[0]?.toString().includes("/old?"))).toBe(false);
  });

  it("throws loudly on a non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 401 }));
    const connector = new GranolaConnector({ enabled: true, apiToken: "bad" });
    await expect(connector.fetchSince(new Date("2026-01-01"))).rejects.toThrow(/granola/);
  });
});
