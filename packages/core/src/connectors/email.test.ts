import { afterEach, describe, expect, it, vi } from "vitest";

import { EmailConnector } from "./email.js";

function gmailMessage(id: string, subject: string, body: string) {
  return {
    id,
    snippet: `snippet for ${id}`,
    internalDate: "1780000000000",
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "From", value: "founder@acme.com" },
        { name: "Subject", value: subject },
      ],
      parts: [
        {
          mimeType: "text/plain",
          body: { data: Buffer.from(body).toString("base64url") },
        },
      ],
    },
  };
}

describe("EmailConnector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disabled config returns no drafts", async () => {
    const connector = new EmailConnector({ enabled: false, accessToken: "" });
    expect(await connector.fetchSince(new Date("2026-01-01"))).toEqual([]);
    expect(connector.name).toBe("email");
  });

  it("maps gmail messages to shaped ingest drafts with a stable unique source", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.includes("/messages/")) {
        const id = url.split("/messages/")[1]!.split("?")[0]!;
        return new Response(
          JSON.stringify(gmailMessage(id, "Pricing decision", "we go usage based")),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ messages: [{ id: "abc123" }] }), { status: 200 });
    });

    const connector = new EmailConnector({ enabled: true, accessToken: "ya29.test" });
    const drafts = await connector.fetchSince(new Date("2026-01-01"));

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.source).toBe("email:abc123");
    expect(drafts[0]?.text).toBe("Subject: Pricing decision\n\nwe go usage based");
    // internalDate is epoch millis as a string; it becomes the watermark
    expect(drafts[0]?.timestamp).toEqual(new Date(1780000000000));
  });

  it("follows nextPageToken pagination across pages", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.includes("/messages/")) {
        const id = url.split("/messages/")[1]!.split("?")[0]!;
        return new Response(JSON.stringify(gmailMessage(id, "s", "b")), { status: 200 });
      }
      if (url.includes("pageToken=PAGE2")) {
        return new Response(JSON.stringify({ messages: [{ id: "m3" }] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ messages: [{ id: "m1" }, { id: "m2" }], nextPageToken: "PAGE2" }),
        { status: 200 },
      );
    });

    const connector = new EmailConnector({ enabled: true, accessToken: "ya29.test" });
    const drafts = await connector.fetchSince(new Date("2026-01-01"));

    expect(drafts.map((d) => d.source)).toEqual(["email:m1", "email:m2", "email:m3"]);
  });

  it("applies the since filter as an after: query, includes config.query, and falls back to snippet", async () => {
    let listUrl = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.includes("/messages/")) {
        // no text/plain part forces the snippet fallback
        return new Response(
          JSON.stringify({
            id: "x1",
            snippet: "short preview text",
            payload: { headers: [{ name: "Subject", value: "Standup" }] },
          }),
          { status: 200 },
        );
      }
      listUrl = url;
      return new Response(JSON.stringify({ messages: [{ id: "x1" }] }), { status: 200 });
    });

    const since = new Date("2026-01-01T00:00:00Z");
    const connector = new EmailConnector({
      enabled: true,
      accessToken: "ya29.test",
      query: "from:founder@acme.com",
    });
    const drafts = await connector.fetchSince(since);

    const decoded = decodeURIComponent(listUrl);
    const epoch = Math.floor(since.getTime() / 1000);
    expect(decoded).toContain(`after:${epoch}`);
    expect(decoded).toContain("from:founder@acme.com");
    expect(drafts[0]?.text).toBe("Subject: Standup\n\nshort preview text");
  });
});
