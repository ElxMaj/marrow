import { afterEach, describe, expect, it, vi } from "vitest";

import { IntercomConnector } from "./intercom.js";

describe("IntercomConnector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disabled config returns no drafts", async () => {
    const connector = new IntercomConnector({ enabled: false, token: "" });
    expect(await connector.fetchSince(new Date("2026-01-01"))).toEqual([]);
    expect(connector.name).toBe("intercom");
  });

  it("maps a conversation to a draft whose timestamp is updated_at in millis", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (/\/conversations\/[^?]+$/.test(url)) {
        return new Response(
          JSON.stringify({
            conversation_parts: {
              conversation_parts: [
                {
                  author: { name: "Ana", type: "admin" },
                  body: "we shipped it",
                  created_at: 1780000000,
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ conversations: [{ id: "c1", updated_at: 1780000500 }] }),
        { status: 200 },
      );
    });

    const connector = new IntercomConnector({ enabled: true, token: "x" });
    const drafts = await connector.fetchSince(new Date("2026-01-01"));

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.source).toBe("intercom:c1");
    // updated_at is epoch seconds; the watermark is that time in millis
    expect(drafts[0]?.timestamp).toEqual(new Date(1780000500 * 1000));
  });

  it("includes the admin opening source message before conversation parts", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (/\/conversations\/[^?]+$/.test(url)) {
        return new Response(
          JSON.stringify({
            source: {
              author: { name: "Ana", type: "admin" },
              body: "opening admin note",
              created_at: 1780000000,
            },
            conversation_parts: {
              conversation_parts: [
                {
                  author: { name: "Ben", type: "admin" },
                  body: "follow-up admin note",
                  created_at: 1780000100,
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ conversations: [{ id: "c2", updated_at: 1780000500 }] }),
        { status: 200 },
      );
    });

    const connector = new IntercomConnector({ enabled: true, token: "x" });
    const drafts = await connector.fetchSince(new Date("2026-01-01"));

    expect(drafts[0]?.text).toContain("Ana: opening admin note");
    expect(drafts[0]?.text).toContain("Ben: follow-up admin note");
    expect(drafts[0]?.text.indexOf("Ana:")).toBeLessThan(drafts[0]?.text.indexOf("Ben:") ?? 0);
  });
});
