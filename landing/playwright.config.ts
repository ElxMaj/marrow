import { defineConfig, devices } from "@playwright/test";

// E2E for the exported page. WebKit is the minimum bar for iOS Safari's
// sticky behavior; run `pnpm build` first, the server just serves out/.
// Deliberately not part of `pnpm -r test`: this is the pre-launch gate
// (docs/launch.md), CI's per-commit gate is scripts/check-ids.mjs.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4179",
  },
  webServer: {
    command: "python3 -m http.server 4179 -d out -b 127.0.0.1",
    url: "http://127.0.0.1:4179",
    reuseExistingServer: true,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
