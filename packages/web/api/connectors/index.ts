import type { IncomingMessage, ServerResponse } from "node:http";

import { encryptSecret } from "@marrowhq/core";

import { READ_ONLY, connectorViews, getStore, readJson, sendJson } from "../_core.js";

// GET  /api/connectors — one row per connector: stored config merged with live
//      sync state (last sync, items, ok/error/never, last error).
// POST /api/connectors — upsert a connector config, encrypting the secret at
//      rest before it touches the database. refused in a read-only demo.
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const store = getStore();
  if (req.method === "GET") {
    return sendJson(res, 200, await connectorViews(store));
  }
  if (req.method === "POST") {
    if (READ_ONLY)
      return sendJson(res, 403, { error: "this is a read-only demo; writes are disabled" });
    const body = await readJson(req);
    const name = body.name as string | undefined;
    const kind = body.kind as string | undefined;
    if (!name || !kind) return sendJson(res, 400, { error: "name and kind are required" });
    const secret = body.secret as string | undefined;
    const secretCipher = secret && secret.length > 0 ? encryptSecret(secret) : undefined;
    const record = await store.upsertConnectorConfig({
      name,
      kind,
      enabled: (body.enabled as boolean | undefined) ?? true,
      settings: (body.settings as Record<string, unknown> | undefined) ?? {},
      ...(secretCipher ? { secretCipher } : {}),
    });
    return sendJson(res, 200, record);
  }
  sendJson(res, 405, { error: "method not allowed" });
}
