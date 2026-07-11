import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The session-end hook mines a finished session into the brain. It is a plain
// shell hook, not a daemon, and it must only ever append evidence: distillation
// and the human loop stay separate. These guards keep it honest.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hook = join(root, "scripts", "session-end-hook.sh");

test("session-end hook is executable", async () => {
  const info = await stat(hook);
  assert.ok((info.mode & 0o111) !== 0, "session-end-hook.sh should be executable");
});

test("session-end hook only ever appends evidence via `marrow add`", async () => {
  const src = await readFile(hook, "utf8");
  const verbs = [...src.matchAll(/\$\{?MARROW\}?\s+(\w[\w-]*)/g)].map((m) => m[1]);
  assert.ok(verbs.length > 0, "the hook should invoke the marrow cli at least once");
  // append only: it must not distill, answer, or otherwise mutate the brain.
  assert.deepEqual([...new Set(verbs)], ["add"], "the hook should only call `marrow add`");
});
