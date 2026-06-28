import type { IncomingMessage, ServerResponse } from "node:http";

import { READ_ONLY, getStore, readJson, sendJson } from "../../_core.js";

// POST /api/connectors/:name/enable { enabled } — flip a connector on or off.
// disabled connectors are skipped by SyncEngine.runAll. refused in a read-only
// demo.
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
  if (READ_ONLY)
    return sendJson(res, 403, { error: "this is a read-only demo; writes are disabled" });
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const segments = path.split("/").filter(Boolean); // api, connectors, :name, enable
  const name = decodeURIComponent(segments[segments.length - 2] ?? "");
  const body = await readJson(req);
  const enabled = (body.enabled as boolean | undefined) ?? true;
  await getStore().setConnectorEnabled(name, enabled);
  sendJson(res, 200, { name, enabled });
}
