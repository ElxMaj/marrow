import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { promisify } from "node:util";

// PR-17: diff-scoped drift detection. Reads git diffs, never the whole repo,
// so catches point to exact file/line provenance and noisy whole-repo scans
// disappear. The repo is still never a source of truth.

const execFileAsync = promisify(execFile);

const CODE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rb",
  ".java",
]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage"]);
const MAX_BYTES = 200_000;

export interface DiffHunk {
  path: string;
  lineStart: number;
  lineEnd: number;
  oldLines: string;
  newLines: string;
  hunkHeader: string;
}

export type DiffScope = "unstaged" | "staged" | string;

/** Read the repo's source code, read only and capped. Kept for the legacy
 *  whole-repo scan path; new drift detection should use readGitDiff. */
export async function readRepoCode(repoPath: string): Promise<string> {
  const chunks: string[] = [];
  let total = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 6 || total > MAX_BYTES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (total > MAX_BYTES) return;
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(p, depth + 1);
      } else if (CODE_EXTS.has(extname(entry.name))) {
        try {
          const text = await readFile(p, "utf8");
          chunks.push(text);
          total += text.length;
        } catch {
          // Unreadable file, skip; the scan stays best-effort and read-only.
        }
      }
    }
  }

  await walk(repoPath, 0);
  return chunks.join("\n");
}

/** Run git diff in repoPath and return only the added/modified hunks. Deleted
 *  hunks are ignored because drift is about new code contradicting decided
 *  facts. Fails loud if repoPath is not a git repo or git is unavailable. */
export async function readGitDiff(
  repoPath: string,
  scope: DiffScope = "unstaged",
): Promise<DiffHunk[]> {
  const args = ["diff", "--no-color"];
  if (scope === "staged") args.push("--staged");
  else if (scope !== "unstaged" && scope) args.push(scope);

  let stdout: string;
  try {
    const result = await execFileAsync("git", args, { cwd: repoPath, maxBuffer: 50 * 1024 * 1024 });
    stdout = result.stdout;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not a git repository/i.test(message)) {
      throw new Error(
        `drift: ${repoPath} is not a git repo. Run 'git init' or point to a git checkout.`,
      );
    }
    throw new Error(`drift: git diff failed in ${repoPath}: ${message}`);
  }

  return parseGitDiff(stdout);
}

/** Parse `git diff --no-color` output into added/modified hunks. */
export function parseGitDiff(stdout: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = stdout.split("\n");
  let currentPath: string | undefined;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line) {
      i += 1;
      continue;
    }

    if (line.startsWith("diff --git ")) {
      // git wraps the WHOLE a/ b/ path in quotes when it contains spaces
      // ("a/src/auth service.ts"), so the quotes sit outside the a/ prefix.
      const rest = line.slice("diff --git ".length);
      const quoted = /^"a\/(.+)" "b\/(.+)"$/.exec(rest);
      const plain = quoted ? null : /^a\/(.+) b\/(.+)$/.exec(rest);
      currentPath = (quoted ?? plain)?.[2];
      i += 1;
      continue;
    }

    if (line.startsWith("+++ ")) {
      // b/path is the new file path; use it when available. strip an optional
      // surrounding quote and the b/ prefix; /dev/null means a deletion.
      let p = line.slice(4).trim();
      if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
      if (p.startsWith("b/")) p = p.slice(2);
      if (p !== "/dev/null") currentPath = p;
      i += 1;
      continue;
    }

    if (line.startsWith("@@")) {
      const header = line;
      const hunkMatch = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (!hunkMatch || !currentPath) {
        i += 1;
        continue;
      }
      const newStart = Number(hunkMatch[2]);
      let newLine = newStart;
      let lineStart = -1;
      let lineEnd = -1;
      const newLines: string[] = [];
      const oldLines: string[] = [];
      i += 1;

      while (i < lines.length) {
        const hunkLine = lines[i];
        if (hunkLine === undefined) break;
        if (hunkLine.startsWith("diff --git") || hunkLine.startsWith("@@")) break;
        if (hunkLine === "") {
          // blank context line advances the new-file line counter.
          newLine += 1;
          i += 1;
          continue;
        }
        if (hunkLine.startsWith("\\")) {
          // "\ No newline at end of file" marker.
          i += 1;
          continue;
        }
        if (hunkLine.startsWith("+")) {
          const text = hunkLine.slice(1);
          newLines.push(text);
          if (lineStart < 0) lineStart = newLine;
          lineEnd = newLine;
          newLine += 1;
        } else if (hunkLine.startsWith("-")) {
          oldLines.push(hunkLine.slice(1));
        } else {
          // context line appears in both old and new.
          newLine += 1;
        }
        i += 1;
      }

      if (lineStart > 0) {
        hunks.push({
          path: currentPath,
          lineStart,
          lineEnd,
          oldLines: oldLines.join("\n"),
          newLines: newLines.join("\n"),
          hunkHeader: header,
        });
      }
      continue;
    }

    i += 1;
  }

  return hunks;
}
