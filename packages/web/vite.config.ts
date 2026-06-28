import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// the frontend is a thin client. in dev it proxies /api to the local API
// server (see server-main.ts); in prod that same server serves the built dist.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
  },
  build: { outDir: "dist/client" },
  // the api + server tests share one Postgres; run files serially so their
  // per-test table resets do not clobber each other.
  test: {
    fileParallelism: false,
  },
});
