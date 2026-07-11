// CI drift gate for the published numbers: regenerate the scorecard into a
// temp file and diff the deterministic fields against the committed
// benchmark/report.json. If the code moved a number, the PR must regenerate
// the report (pnpm benchmark) so the public claims can never silently drift.
// Latency fields are stripped before comparing: they vary per run and prove
// nothing about the claims.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/** Drop every nondeterministic field, recursively: anything latency- or
 *  wall-clock-shaped. Exported for the test. */
export function stripNondeterministic(value) {
  if (Array.isArray(value)) return value.map(stripNondeterministic);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (/latency|ingestionready/i.test(key)) continue;
      out[key] = stripNondeterministic(val);
    }
    return out;
  }
  return value;
}

/** First differing path between two stripped reports, or null when equal. */
export function firstDifference(a, b, path = "report") {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return `${path}: array shape differs`;
    }
    for (let i = 0; i < a.length; i += 1) {
      const diff = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (diff) return diff;
    }
    return null;
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      const diff = firstDifference(a[key], b[key], `${path}.${key}`);
      if (diff) return diff;
    }
    return null;
  }
  if (a !== b) return `${path}: committed ${JSON.stringify(a)} vs regenerated ${JSON.stringify(b)}`;
  return null;
}

function main() {
  const committed = JSON.parse(readFileSync(join(root, "benchmark", "report.json"), "utf8"));

  const outDir = mkdtempSync(join(tmpdir(), "marrow-drift-gate-"));
  const outPath = join(outDir, "report.json");
  try {
    execFileSync("pnpm", ["benchmark"], {
      cwd: root,
      stdio: ["ignore", "ignore", "inherit"],
      env: { ...process.env, MARROW_REPORT_OUT: outPath },
    });
    const regenerated = JSON.parse(readFileSync(outPath, "utf8"));

    const diff = firstDifference(
      stripNondeterministic(committed),
      stripNondeterministic(regenerated),
    );
    if (diff) {
      console.error("benchmark drift: the committed report no longer matches the code.");
      console.error(diff);
      console.error("Run `pnpm benchmark` and commit the regenerated benchmark/report.json.");
      process.exit(1);
    }
    console.log("benchmark drift gate: committed report matches the code.");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
