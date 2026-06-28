import { defineConfig } from "vitest/config";

// Like core, these tests share one Postgres. Run test files serially so their
// per-test table resets do not deadlock or clobber each other.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
