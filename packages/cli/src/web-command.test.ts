import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Marrow } from "@marrowhq/core";
import { startWebServer as startRealWebServer } from "@marrowhq/web";
import { describe, expect, it, vi } from "vitest";

import { runWebCommand } from "./web-command.js";

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!address || typeof address === "string") throw new Error("expected an ephemeral port");
  return address.port;
}

describe("cli web command", () => {
  it("starts the question-loop UI, opens the browser on request, and shuts down cleanly", async () => {
    const core = { close: vi.fn(async () => undefined) } as unknown as Marrow;
    const server = { close: vi.fn() };
    const startWebServer = vi.fn(async ({ core: actualCore, port }) => {
      expect(actualCore).toBe(core);
      expect(port).toBe(9000);
      return { server, url: "http://localhost:9000" };
    });
    const signals = new Map<string, () => Promise<void>>();
    const opened: string[] = [];
    const logs: string[] = [];
    const exits: number[] = [];

    await runWebCommand(["web", "--port", "9000", "--open"], {
      createCore: () => core,
      startWebServer,
      openBrowser: (url) => opened.push(url),
      onSignal: (signal, shutdown) => signals.set(signal, shutdown),
      exit: (code) => exits.push(code ?? 0),
      log: (message) => logs.push(message),
      stay: async () => undefined,
    });

    expect(startWebServer).toHaveBeenCalledOnce();
    expect(logs.join("\n")).toContain("marrow web");
    expect(logs.join("\n")).toContain("http://localhost:9000");
    expect(logs.join("\n")).toContain("Ctrl+C to stop");
    expect(opened).toEqual(["http://localhost:9000"]);
    expect(signals.has("SIGINT")).toBe(true);
    expect(signals.has("SIGTERM")).toBe(true);

    await signals.get("SIGINT")?.();

    expect(server.close).toHaveBeenCalledOnce();
    expect(core.close).toHaveBeenCalledOnce();
    expect(exits).toEqual([0]);
  });

  it("uses PORT when --port is omitted", async () => {
    const core = { close: vi.fn(async () => undefined) } as unknown as Marrow;
    const startWebServer = vi.fn(async () => ({
      server: { close: vi.fn() },
      url: "http://localhost:7331",
    }));

    await runWebCommand(["web"], {
      env: { PORT: "7331" },
      createCore: () => core,
      startWebServer,
      log: () => undefined,
      stay: async () => undefined,
    });

    expect(startWebServer).toHaveBeenCalledWith({ core, port: 7331 });
  });

  it("boots the real web server and serves /api/state until shutdown", async () => {
    const clientDir = mkdtempSync(join(tmpdir(), "marrow-cli-web-"));
    writeFileSync(join(clientDir, "index.html"), "<!doctype html><title>marrow</title>");
    const core = {
      close: vi.fn(async () => undefined),
      getDecisions: vi.fn(async () => []),
      listEntities: vi.fn(async () => []),
      getOpenQuestions: vi.fn(async () => []),
      getGraph: vi.fn(async () => ({ nodes: [], edges: [] })),
    } as unknown as Marrow;
    const port = await freePort();
    const signals = new Map<string, () => Promise<void>>();
    let startedUrl = "";

    try {
      await runWebCommand(["web", "--port", String(port)], {
        createCore: () => core,
        startWebServer: async ({ core: actualCore, port: actualPort }) => {
          const started = await startRealWebServer({
            core: actualCore,
            port: actualPort,
            clientDir,
          });
          startedUrl = started.url;
          return started;
        },
        onSignal: (signal, shutdown) => signals.set(signal, shutdown),
        exit: () => undefined,
        log: () => undefined,
        stay: async () => {
          const res = await fetch(`${startedUrl}/api/state`);
          expect(res.status).toBe(200);
          await expect(res.json()).resolves.toMatchObject({
            decisions: [],
            entities: [],
            questions: [],
          });
        },
      });

      expect(startedUrl).toBe(`http://localhost:${port}`);
      expect(signals.has("SIGINT")).toBe(true);

      await signals.get("SIGINT")?.();

      expect(core.close).toHaveBeenCalledOnce();
    } finally {
      rmSync(clientDir, { recursive: true, force: true });
    }
  });
});
