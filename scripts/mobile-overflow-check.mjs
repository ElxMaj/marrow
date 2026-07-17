// Mobile overflow gate: the landing and the demo console must lay out inside a
// 390px viewport with no horizontal scroll. Measured the only honest way
// headless Chrome allows on every platform: macOS clamps --window-size below
// ~500px (the screenshot is cropped, not laid out narrow), so a direct
// screenshot at 390 lies. Instead a probe page renders the target in a real
// 390px iframe and reports the document's scrollWidth; anything wider than the
// viewport plus a 2px rounding tolerance fails.
//
// Run: node scripts/mobile-overflow-check.mjs   (after `pnpm --filter @marrowhq/landing build`)
// Skips with a warning when Chrome is not installed (CI images without it).
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
].filter(Boolean);
const chrome = CHROME_CANDIDATES.find((c) => existsSync(c));
if (!chrome) {
  console.warn("mobile-overflow-check: no Chrome found, skipping (set CHROME_BIN to enforce)");
  process.exit(0);
}

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
};

/** Serve a static dir with SPA-ish fallbacks, mirroring the vercel rewrites. */
function serve(dir, extraProbe) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const candidates = path.startsWith("/api/")
        ? [path, `${path}.json`]
        : extname(path)
          ? [path]
          : [path === "/" ? "/index.html" : `${path}.html`, "/index.html"];
      if (path === "/__probe.html") {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(extraProbe);
      }
      for (const c of candidates) {
        try {
          const body = await readFile(join(dir, c));
          res.writeHead(200, { "content-type": TYPES[extname(c)] ?? "application/octet-stream" });
          return res.end(body);
        } catch {
          /* next */
        }
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const PROBE = (target) => `<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<iframe id="f" src="${target}" style="width:390px;height:800px;border:0"></iframe>
<pre id="out">probing</pre>
<script>
  const f = document.getElementById("f");
  f.onload = () => setTimeout(() => {
    const d = f.contentDocument;
    document.getElementById("out").textContent =
      "MOBILE_PROBE scrollWidth=" + d.documentElement.scrollWidth +
      " innerWidth=" + f.contentWindow.innerWidth;
  }, 1500);
</script>`;

async function check(name, dir, target) {
  if (!existsSync(join(dir, "index.html"))) {
    console.warn(`mobile-overflow-check: ${name}: ${dir} has no build, skipping`);
    return true;
  }
  const server = await serve(dir, PROBE(target));
  const port = server.address().port;
  const profile = mkdtempSync(join(tmpdir(), "marrow-mobile-"));
  // a fresh --user-data-dir plus --no-sandbox HANGS headless Chrome on macOS
  // (verified: the same invocation without them completes in under 2s). linux
  // CI containers are the ones that need both, so they are linux-only.
  const linuxOnly =
    process.platform === "linux" ? ["--no-sandbox", `--user-data-dir=${profile}`] : [];
  try {
    // async, not sync: the probe server lives in THIS process, and a sync
    // spawn would block the event loop, deadlocking Chrome's requests
    // against the very server meant to answer them.
    const { stdout: dom } = await execFileAsync(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        ...linuxOnly,
        "--dump-dom",
        "--window-size=420,900",
        "--virtual-time-budget=12000",
        `http://127.0.0.1:${port}/__probe.html`,
      ],
      { encoding: "utf8", timeout: 60_000, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024 },
    );
    const m = /MOBILE_PROBE scrollWidth=(\d+) innerWidth=(\d+)/.exec(dom);
    if (!m) {
      console.error(`mobile-overflow-check: ${name}: probe produced no measurement`);
      return false;
    }
    const scrollWidth = Number(m[1]);
    const innerWidth = Number(m[2]);
    const ok = scrollWidth <= innerWidth + 2;
    console.log(
      `mobile-overflow-check: ${name}: scrollWidth=${scrollWidth} viewport=${innerWidth} ${ok ? "ok" : "OVERFLOW"}`,
    );
    return ok;
  } finally {
    server.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

// serial: two headless Chromes racing the same box flake more than they save.
const results = [
  await check("landing", join(root, "landing", "out"), "/index.html"),
  await check(
    "demo console",
    join(root, "packages", "web", "demo-static"),
    "/index.html#/questions",
  ),
];
if (results.every(Boolean)) {
  console.log("mobile-overflow-check: ok");
} else {
  process.exit(1);
}
