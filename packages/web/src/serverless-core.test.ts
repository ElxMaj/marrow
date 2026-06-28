import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { connectorViews, evidenceLite, goalViews, readJson, sendJson } from "../api/_core";

describe("serverless _core helpers", () => {
  it("reads bounded JSON request bodies", async () => {
    const req = Readable.from([Buffer.from(JSON.stringify({ title: "auth" }))]);
    await expect(readJson(req as never)).resolves.toEqual({ title: "auth" });

    const tooLarge = Readable.from([Buffer.alloc(1_000_001, "x")]);
    await expect(readJson(tooLarge as never)).rejects.toThrow(/request body too large/);
  });

  it("writes JSON responses with status and content type", () => {
    const headers: Record<string, string> = {};
    const chunks: string[] = [];
    const res = {
      statusCode: 0,
      setHeader: (key: string, value: string) => {
        headers[key] = value;
      },
      end: (body: string) => {
        chunks.push(body);
      },
    };

    sendJson(res as never, 201, { ok: true });

    expect(res.statusCode).toBe(201);
    expect(headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(chunks).toEqual(['{"ok":true}']);
  });

  it("merges connector config and state without leaking undefined optional fields", async () => {
    const store = {
      listConnectorConfigs: async () => [
        {
          name: "slack",
          kind: "slack",
          enabled: true,
          settings: { channel: "product" },
          hasSecret: true,
          createdAt: "2026-06-20T00:00:00Z",
          updatedAt: "2026-06-20T00:00:00Z",
        },
      ],
      listConnectorState: async () => [
        {
          name: "linear",
          enabled: false,
          lastStatus: "error",
          lastError: "bad token",
          totalItems: 7,
          itemsLastRun: 0,
          updatedAt: "2026-06-21T00:00:00Z",
        },
      ],
    };

    await expect(connectorViews(store as never)).resolves.toStrictEqual([
      {
        name: "linear",
        kind: "linear",
        enabled: false,
        settings: {},
        hasSecret: false,
        lastStatus: "error",
        lastError: "bad token",
        itemsLastRun: 0,
        totalItems: 7,
        updatedAt: "2026-06-21T00:00:00Z",
      },
      {
        name: "slack",
        kind: "slack",
        enabled: true,
        settings: { channel: "product" },
        hasSecret: true,
        lastStatus: "never",
        totalItems: 0,
        createdAt: "2026-06-20T00:00:00Z",
        updatedAt: "2026-06-20T00:00:00Z",
      },
    ]);
  });

  it("resolves goal entity names for the serverless goals route", async () => {
    const store = {
      listGoals: async () => [
        {
          id: "goal_1",
          kind: "goal",
          title: "Fast login",
          goalType: "user",
          entityId: "ent_auth",
          status: "decided",
          confidence: { value: 1, source: "human" },
          provenance: [{ evidenceId: "ev_1", start: 0, end: 5 }],
        },
      ],
      getNode: async (id: string) =>
        id === "ent_auth" ? { id, kind: "entity", name: "Authentication" } : undefined,
    };

    await expect(goalViews(store as never)).resolves.toMatchObject([
      { id: "goal_1", entityName: "Authentication" },
    ]);
  });

  it("trims evidence to a preview without losing raw length", () => {
    const text = "x".repeat(300);
    expect(
      evidenceLite({
        id: "ev_1",
        source: "standup.md",
        createdAt: "2026-06-20T00:00:00Z",
        text,
      }),
    ).toEqual({
      id: "ev_1",
      source: "standup.md",
      createdAt: "2026-06-20T00:00:00Z",
      preview: "x".repeat(280),
      chars: 300,
    });
  });
});
