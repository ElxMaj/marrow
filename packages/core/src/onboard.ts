import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

// PR-12: a one-time, read-only structural read of a repo. It lists candidate
// entities (integrations from package.json, modules from source dirs). It never
// writes to the repo and it is deliberately light: the repo is a question
// generator, not a source of truth.

export interface RepoCandidate {
  name: string;
  where: string;
  snippet: string;
}

const PKG_SECTIONS = ["dependencies", "devDependencies"];
const SOURCE_ROOTS = ["src", "app", "lib", "packages", "services"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", "__tests__", "test"]);

export async function scanRepo(repoPath: string): Promise<RepoCandidate[]> {
  const found = new Map<string, RepoCandidate>();

  try {
    const raw = await readFile(join(repoPath, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    for (const section of PKG_SECTIONS) {
      const deps = pkg[section];
      if (deps && typeof deps === "object") {
        for (const dep of Object.keys(deps as Record<string, unknown>)) {
          if (dep.startsWith("@types/")) continue;
          found.set(dep, { name: dep, where: "package.json", snippet: `integration: ${dep}` });
        }
      }
    }
  } catch {
    // No package.json is fine; the scan stays best-effort and read-only.
  }

  for (const root of SOURCE_ROOTS) {
    let entries;
    try {
      entries = await readdir(join(repoPath, root), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      if (!found.has(entry.name)) {
        found.set(entry.name, {
          name: entry.name,
          where: `${root}/${entry.name}`,
          snippet: `module: ${root}/${entry.name}`,
        });
      }
    }
  }

  return [...found.values()].slice(0, 50);
}
