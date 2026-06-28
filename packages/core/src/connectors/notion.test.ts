import { afterEach, describe, expect, it, vi } from "vitest";

import { NotionConnector } from "./notion.js";

function paragraph(text: string) {
  return { type: "paragraph", paragraph: { rich_text: [{ plain_text: text }] } };
}

function toggle(id: string, text: string) {
  return {
    id,
    type: "toggle",
    has_children: true,
    toggle: { rich_text: [{ plain_text: text }] },
  };
}

describe("NotionConnector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disabled config returns no drafts", async () => {
    const connector = new NotionConnector({ enabled: false, token: "" });
    expect(await connector.fetchSince(new Date("2026-01-01"))).toEqual([]);
    expect(connector.name).toBe("notion");
  });

  it("maps a searched page to a draft whose timestamp is last_edited_time", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.includes("/search")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: "p1",
                url: "https://notion.so/p1",
                last_edited_time: "2026-06-10T12:00:00.000Z",
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ results: [paragraph("we ship monday")] }), {
        status: 200,
      });
    });

    const connector = new NotionConnector({ enabled: true, token: "x" });
    const drafts = await connector.fetchSince(new Date("2026-01-01"));

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.source).toBe("notion:p1");
    expect(drafts[0]?.timestamp).toEqual(new Date("2026-06-10T12:00:00.000Z"));
  });

  it("includes nested child block text for configured page ids", async () => {
    const seen: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      seen.push(url);
      if (url.includes("/blocks/p1/children")) {
        return new Response(
          JSON.stringify({ results: [paragraph("top"), toggle("b1", "parent")] }),
          {
            status: 200,
          },
        );
      }
      if (url.includes("/blocks/b1/children")) {
        return new Response(JSON.stringify({ results: [paragraph("nested")] }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });

    const connector = new NotionConnector({ enabled: true, token: "x", pageIds: ["p1"] });
    const drafts = await connector.fetchSince(new Date("2026-01-01"));

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.source).toBe("notion:p1");
    expect(drafts[0]?.timestamp).toBeUndefined();
    expect(drafts[0]?.text).toBe("top\nparent\nnested");
    expect(seen.some((url) => url.includes("/blocks/b1/children"))).toBe(true);
  });
});
