import { spawn } from "node:child_process";

import { createMarrow, type Marrow } from "@marrowhq/core";

interface WebServerHandle {
  close: () => void;
}

interface WebServerResult {
  server: WebServerHandle;
  url: string;
}

export interface WebCommandDeps {
  env?: Pick<NodeJS.ProcessEnv, "PORT">;
  createCore?: () => Marrow;
  startWebServer?: (options: { core: Marrow; port: number }) => Promise<WebServerResult>;
  openBrowser?: (url: string) => void;
  onSignal?: (signal: NodeJS.Signals, shutdown: () => Promise<void>) => void;
  exit?: (code: number) => void;
  log?: (message: string) => void;
  stay?: () => Promise<unknown>;
}

const flagValue = (argv: string[], name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
};

/** Best-effort open the default browser; never fail the command if it cannot. */
export function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], {
      stdio: "ignore",
      detached: true,
      shell: process.platform === "win32",
    }).unref();
  } catch {
    // A headless box has no browser; the printed URL is enough.
  }
}

async function startWebServer(options: { core: Marrow; port: number }): Promise<WebServerResult> {
  const web = await import("@marrowhq/web");
  return web.startWebServer(options);
}

/** `marrow web`: boot the question-loop UI and stay up until interrupted. */
export async function runWebCommand(argv: string[], deps: WebCommandDeps = {}): Promise<void> {
  const port = Number(flagValue(argv, "--port") ?? deps.env?.PORT ?? process.env.PORT ?? 8787);
  const core = (deps.createCore ?? createMarrow)();
  const launch = deps.startWebServer ?? startWebServer;
  const { server, url } = await launch({ core, port });
  const log = deps.log ?? console.log;
  log(`marrow web → ${url}\nBrowse the brain and answer open questions. Ctrl+C to stop.`);

  if (argv.includes("--open")) (deps.openBrowser ?? openBrowser)(url);

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close();
    await core.close();
    (deps.exit ?? process.exit)(0);
  };
  const onSignal = deps.onSignal ?? process.on.bind(process);
  onSignal("SIGINT", shutdown);
  onSignal("SIGTERM", shutdown);

  await (deps.stay ?? (() => new Promise<never>(() => {})))();
}
