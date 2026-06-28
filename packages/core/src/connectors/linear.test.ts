import { afterEach, describe, expect, it, vi } from "vitest";

import { LinearConnector } from "./linear.js";

describe("LinearConnector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disabled config returns no drafts", async () => {
    const connector = new LinearConnector({ enabled: false, token: "" });
    expect(await connector.fetchSince(new Date("2026-01-01"))).toEqual([]);
    expect(connector.name).toBe("linear");
  });

  it("maps an issue to a draft whose timestamp is the issue updatedAt", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            issues: {
              nodes: [
                {
                  id: "i1",
                  identifier: "ENG-1",
                  title: "ship soft delete",
                  description: "recoverable deletes",
                  updatedAt: "2026-06-10T12:00:00.000Z",
                },
              ],
            },
          },
        }),
        { status: 200 },
      ),
    );

    const connector = new LinearConnector({ enabled: true, token: "x" });
    const drafts = await connector.fetchSince(new Date("2026-01-01"));

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.source).toBe("linear:ENG-1");
    expect(drafts[0]?.timestamp).toEqual(new Date("2026-06-10T12:00:00.000Z"));
  });

  // F-CORE-054: filter by updatedAt server-side, order by updatedAt, and paginate
  // so recently-updated issues beyond the first page are not silently dropped.
  it("paginates and filters by updatedAt server-side", async () => {
    const page = (nodes: unknown[], hasNextPage: boolean, endCursor?: string) =>
      new Response(
        JSON.stringify({ data: { issues: { nodes, pageInfo: { hasNextPage, endCursor } } } }),
        {
          status: 200,
        },
      );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        page(
          [
            {
              id: "i1",
              identifier: "ENG-1",
              title: "a",
              description: "",
              updatedAt: "2026-06-10T12:00:00.000Z",
            },
          ],
          true,
          "cur1",
        ),
      )
      .mockResolvedValueOnce(
        page(
          [
            {
              id: "i2",
              identifier: "ENG-2",
              title: "b",
              description: "",
              updatedAt: "2026-06-11T12:00:00.000Z",
            },
          ],
          false,
        ),
      );

    const connector = new LinearConnector({ enabled: true, token: "x" });
    const drafts = await connector.fetchSince(new Date("2026-06-01T00:00:00.000Z"));

    // both pages are collected.
    expect(drafts.map((d) => d.source)).toEqual(["linear:ENG-1", "linear:ENG-2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const body0 = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    const body1 = JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string);
    // server-side updatedAt filter + ordering, and the second call threads the cursor.
    expect(body0.variables.filter.updatedAt.gte).toBe("2026-06-01T00:00:00.000Z");
    expect(body0.query).toMatch(/orderBy/);
    expect(body1.variables.after).toBe("cur1");
  });
});
