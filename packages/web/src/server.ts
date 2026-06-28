import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type Marrow } from "@marrowhq/core";

import { createApiServer } from "./api.js";

/** Find the built SPA. Published: this module is dist/server.js, so the client
 *  is the sibling dist/client. Dev (run from src via tsx): fall back to the
 *  built ../dist/client so `marrow web` serves a real UI without a prod build. */
function resolveClientDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const sibling = join(here, "client");
  return existsSync(sibling) ? sibling : join(here, "..", "dist", "client");
}

// Programmatic boot for the question-loop UI. The CLI imports this from the
// published package to launch the web view, so the same code path serves dev
// (start) and prod (published install). Zero product logic: it only wires core
// into the thin HTTP server.

export interface StartWebServerOptions {
  core: Marrow;
  port?: number;
  host?: string;
  clientDir?: string;
}

export async function startWebServer(
  options: StartWebServerOptions,
): Promise<{ server: Server; url: string }> {
  const clientDir = options.clientDir ?? resolveClientDir();
  // bind to localhost by default: the question-loop view is a single-user local
  // tool and /api/answer is the privileged promote-to-decided path. binding
  // 0.0.0.0 would expose that write to the network. override with
  // MARROW_WEB_HOST only if you intend to serve it (with real auth in front).
  const host = options.host ?? process.env.MARROW_WEB_HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.PORT ?? 8787);

  const server = createApiServer(options.core, { clientDir });
  await new Promise<void>((res) => server.listen(port, host, res));

  const url = `http://${host === "127.0.0.1" ? "localhost" : host}:${port}`;
  return { server, url };
}
