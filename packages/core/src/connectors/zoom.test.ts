import { afterEach, describe, expect, it, vi } from "vitest";

import { ZoomConnector } from "./zoom.js";

describe("ZoomConnector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("disabled config returns no drafts", async () => {
    const connector = new ZoomConnector({
      enabled: false,
      accountId: "",
      clientId: "",
      clientSecret: "",
    });
    expect(await connector.fetchSince(new Date("2026-01-01"))).toEqual([]);
    expect(connector.name).toBe("zoom");
  });

  it("maps a meeting without a transcript to a draft whose timestamp is start_time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:00:00Z"));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.includes("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          meetings: [
            {
              uuid: "u1",
              id: "m1",
              topic: "Pricing sync",
              start_time: "2026-06-10T12:00:00Z",
              recording_files: [],
            },
          ],
        }),
        { status: 200 },
      );
    });

    const connector = new ZoomConnector({
      enabled: true,
      accountId: "a",
      clientId: "c",
      clientSecret: "s",
    });
    const drafts = await connector.fetchSince(new Date("2026-06-01T00:00:00Z"));

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.source).toBe("zoom:m1");
    expect(drafts[0]?.timestamp).toEqual(new Date("2026-06-10T12:00:00Z"));
  });

  it("downloads transcript files and uses zoom meeting/file provenance", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:00:00Z"));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = input.toString();
      if (url.includes("/oauth/token")) {
        expect(init?.headers).toMatchObject({
          Authorization: `Basic ${Buffer.from("client:secret").toString("base64")}`,
        });
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      }
      if (url.includes("/users/me/recordings")) {
        return new Response(
          JSON.stringify({
            meetings: [
              {
                uuid: "u1",
                id: "m1",
                topic: "Auth sync",
                start_time: "2026-06-11T12:00:00Z",
                recording_files: [
                  {
                    id: "file1",
                    file_type: "TRANSCRIPT",
                    download_url: "https://zoom.test/download/file1",
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      }
      expect(url).toBe("https://zoom.test/download/file1");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer tok" });
      return new Response("WEBVTT\n\n00:00.000 --> 00:02.000\nMagic links only.", {
        status: 200,
      });
    });

    const connector = new ZoomConnector({
      enabled: true,
      accountId: "account",
      clientId: "client",
      clientSecret: "secret",
    });
    const drafts = await connector.fetchSince(new Date("2026-06-01T00:00:00Z"));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(drafts).toEqual([
      {
        text: "WEBVTT\n\n00:00.000 --> 00:02.000\nMagic links only.",
        source: "zoom:m1:file1",
        timestamp: new Date("2026-06-11T12:00:00Z"),
      },
    ]);
  });

  it("pages recording lists with next_page_token across bounded date windows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
    const recordingSearches: string[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.includes("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      }
      const parsed = new URL(url);
      recordingSearches.push(parsed.search);
      const from = parsed.searchParams.get("from");
      const to = parsed.searchParams.get("to");
      const pageToken = parsed.searchParams.get("next_page_token");
      if (from === "2026-01-15" && to === "2026-02-13" && pageToken === null) {
        return new Response(
          JSON.stringify({
            next_page_token: "next-window-page",
            meetings: [
              {
                uuid: "u1",
                id: "w1p1",
                topic: "Window one page one",
                start_time: "2026-01-20T12:00:00Z",
                recording_files: [],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (from === "2026-01-15" && to === "2026-02-13" && pageToken === "next-window-page") {
        return new Response(
          JSON.stringify({
            meetings: [
              {
                uuid: "u2",
                id: "w1p2",
                topic: "Window one page two",
                start_time: "2026-01-21T12:00:00Z",
                recording_files: [],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (from === "2026-02-14" && to === "2026-03-10" && pageToken === null) {
        return new Response(
          JSON.stringify({
            meetings: [
              {
                uuid: "u3",
                id: "w2p1",
                topic: "Window two page one",
                start_time: "2026-02-20T12:00:00Z",
                recording_files: [],
              },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected Zoom URL ${url}`);
    });

    const connector = new ZoomConnector({
      enabled: true,
      accountId: "account",
      clientId: "client",
      clientSecret: "secret",
    });

    const drafts = await connector.fetchSince(new Date("2026-01-15T00:00:00Z"));

    expect(recordingSearches).toEqual([
      "?from=2026-01-15&to=2026-02-13&page_size=300",
      "?from=2026-01-15&to=2026-02-13&page_size=300&next_page_token=next-window-page",
      "?from=2026-02-14&to=2026-03-10&page_size=300",
    ]);
    expect(drafts.map((draft) => draft.source)).toEqual(["zoom:w1p1", "zoom:w1p2", "zoom:w2p1"]);
  });

  it("refreshes a cached token once when Zoom returns 401", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:00:00Z"));
    const tokens = ["old-token", "fresh-token"];
    const bearerHeaders: unknown[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = input.toString();
      if (url.includes("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: tokens.shift() }), { status: 200 });
      }
      bearerHeaders.push(init?.headers);
      if (bearerHeaders.length === 1) {
        return new Response("expired", { status: 401 });
      }
      return new Response(
        JSON.stringify({
          meetings: [
            {
              uuid: "u1",
              id: "m1",
              topic: "Token refresh sync",
              start_time: "2026-06-11T12:00:00Z",
              recording_files: [],
            },
          ],
        }),
        { status: 200 },
      );
    });

    const connector = new ZoomConnector({
      enabled: true,
      accountId: "account",
      clientId: "client",
      clientSecret: "secret",
    });

    const drafts = await connector.fetchSince(new Date("2026-06-01T00:00:00Z"));

    expect(bearerHeaders).toEqual([
      { Authorization: "Bearer old-token" },
      { Authorization: "Bearer fresh-token" },
    ]);
    expect(drafts.map((draft) => draft.source)).toEqual(["zoom:m1"]);
  });
});
