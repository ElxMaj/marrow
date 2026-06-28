import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

function withoutDatabaseUrl(): NodeJS.ProcessEnv {
  const { DATABASE_URL: _databaseUrl, ...env } = process.env;
  return env;
}

describe("mcp stdio entrypoint", () => {
  it("exits nonzero with a clean config error when DATABASE_URL is missing", () => {
    const result = spawnSync("pnpm", ["exec", "tsx", join(here, "main.ts")], {
      cwd: join(here, ".."),
      env: withoutDatabaseUrl(),
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "DATABASE_URL is not set. Point it at your Postgres and retry.",
    );
    expect(result.stderr).not.toContain("at createStore");
  });
});
