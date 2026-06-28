import { afterEach, describe, expect, it, vi } from "vitest";

import { FigmaConnector } from "./figma.js";

describe("FigmaConnector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disabled config returns no drafts", async () => {
    const connector = new FigmaConnector({ enabled: false, token: "", fileKeys: ["F1"] });
    expect(await connector.fetchSince(new Date("2026-01-01"))).toEqual([]);
    expect(connector.name).toBe("figma");
  });

  it("maps a comment to a draft whose timestamp is created_at", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          comments: [
            {
              id: "cm1",
              message: "this button is too small",
              created_at: "2026-06-10T12:00:00.000Z",
              file_key: "F1",
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const connector = new FigmaConnector({ enabled: true, token: "x", fileKeys: ["F1"] });
    const drafts = await connector.fetchSince(new Date("2026-01-01"));

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.source).toBe("figma:F1:cm1");
    expect(drafts[0]?.timestamp).toEqual(new Date("2026-06-10T12:00:00.000Z"));
  });
});
