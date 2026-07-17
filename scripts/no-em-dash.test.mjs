import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// CLAUDE.md's writing style forbids em dashes: they are the single most
// recognizable AI-writing tell, and Marrow markets itself as anti-slop. This
// guard fails CI if one creeps back into a surface a user actually reads: the
// README front door, the CLI help and console output, the landing page, and the
// published CHANGELOGs. Test fixtures are excluded on purpose, since a few carry
// an em dash to prove transcript normalization handles it.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EM_DASH = "—";

async function targetFiles() {
  // The landing is a Next.js app: scan its source copy (app/, components/,
  // content/), not a build artifact.
  const files = ["README.md"];
  for (const dir of ["landing/app", "landing/components", "landing/content"]) {
    for (const file of await readdir(join(root, dir), { recursive: true })) {
      if (/\.(ts|tsx|css|md)$/.test(file) && !file.includes(".test.")) {
        files.push(join(dir, file));
      }
    }
  }
  for (const pkg of await readdir(join(root, "packages"))) {
    const changelog = join("packages", pkg, "CHANGELOG.md");
    try {
      await readFile(join(root, changelog), "utf8");
      files.push(changelog);
    } catch {
      // not every package ships a CHANGELOG; skip the ones that do not.
    }
  }
  for (const file of await readdir(join(root, "packages/cli/src"))) {
    if (file.endsWith(".ts") && !file.endsWith(".test.ts")) {
      files.push(join("packages/cli/src", file));
    }
  }
  return files;
}

test("no em dashes in the surfaces a user reads", async () => {
  const offenders = [];
  for (const rel of await targetFiles()) {
    const text = await readFile(join(root, rel), "utf8");
    text.split("\n").forEach((line, i) => {
      if (line.includes(EM_DASH)) offenders.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `Em dash (U+2014) is banned in user-visible copy (CLAUDE.md writing style). Use a comma, colon, or period instead:\n  ${offenders.join("\n  ")}`,
  );
});
