// Local dev entry: boots the question-loop server over a fresh core. It routes
// through startWebServer so dev `start` and the published CLI path share one
// code path. The only difference is clientDir: in dev the built SPA lives at
// ../dist/client (vite build output), in the published package it sits next to
// the compiled server as ./client (the startWebServer default).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createMarrow } from "@marrowhq/core";

import { startWebServer } from "./server.js";

const here = dirname(fileURLToPath(import.meta.url));
const { url } = await startWebServer({
  core: createMarrow(),
  clientDir: join(here, "..", "dist", "client"),
});
console.log(`marrow web on ${url}`);
