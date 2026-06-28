import { defineConfig } from "vitest/config";

// Core's tests share one Postgres. Run test files serially so their per-test
// table resets do not deadlock against each other. Tests within a file already
// run in order.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
