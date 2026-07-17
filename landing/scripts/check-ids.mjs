// The landing may only cite seeded facts, forever. Every element carrying
// data-ev + data-span must point at a real span in the demo seed's room
// documents, and every highlighted passage must quote its span verbatim.
//
// v2 runs against the BUILT artifact (out/index.html), never JSX source, and
// parses with a real HTML parser so minified attribute order, React comment
// nodes and entity encoding cannot produce false passes or false failures.
// It also guards the page's non-negotiables: one DEMO_URL source of truth,
// the no-JS finished-document state, the first-load JS budget, the sticky
// killer overflow-x rule, and the CSS/TS motion-token mirror.
//
// Run: node scripts/check-ids.mjs out/index.html   (from landing/, via pnpm test)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";

const here = dirname(fileURLToPath(import.meta.url));
const landingDir = join(here, "..");
const repoDir = join(landingDir, "..");

const htmlPath = resolve(process.cwd(), process.argv[2] ?? join(landingDir, "out", "index.html"));
const html = readFileSync(htmlPath, "utf8");
const outDir = dirname(htmlPath);

const seed = readFileSync(join(repoDir, "packages", "web", "scripts", "seed-room.ts"), "utf8");
const coreDemo = readFileSync(join(repoDir, "packages", "core", "src", "demo.ts"), "utf8");

let failures = 0;
function fail(msg) {
  failures += 1;
  console.error(`check-ids: ${msg}`);
}

function doc(src, name, where) {
  const m = src.match(new RegExp("const " + name + " = `([\\s\\S]*?)`;"));
  if (!m) fail(`seed document ${name} not found in ${where}`);
  return m ? m[1] : "";
}

// The landing's illustrative evidence ids, each bound to one seed document.
// The design-partner interview is core's DEMO_INTERVIEW: one transcript everywhere.
const DOCS = {
  ev_3f9a: doc(coreDemo, "DEMO_INTERVIEW", "core/src/demo.ts"),
  ev_77c1: doc(seed, "STANDUP", "seed-room.ts"),
  ev_41c2: doc(seed, "REVIEW", "seed-room.ts"),
  ev_9b2e: doc(seed, "PRICING_CALL", "seed-room.ts"),
};

const { document } = parseHTML(html);

const flatten = (s) => s.replace(/\s+/g, " ").trim();

// ---- 1. every citation points at a real span; marks quote it verbatim ----
const REF_SHAPE = /^ev_\w+ (?:· )?\[\d+–\d+\]$/;
const cited = [...document.querySelectorAll("[data-ev][data-span]")];
let checkedRefs = 0;
for (const el of cited) {
  const ev = el.getAttribute("data-ev");
  const spanAttr = el.getAttribute("data-span") ?? "";
  const inner = flatten(el.textContent ?? "");
  if (REF_SHAPE.test(inner)) checkedRefs += 1;
  const text = DOCS[ev];
  if (text === undefined) {
    fail(`${ev}: unknown evidence id (no seed document bound)`);
    continue;
  }
  const m = spanAttr.match(/^(\d+)-(\d+)$/);
  if (!m) {
    fail(`${ev}: malformed data-span "${spanAttr}"`);
    continue;
  }
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (!(start >= 0 && end > start && end <= text.length)) {
    fail(`${ev} [${start}-${end}]: span out of range for its document`);
    continue;
  }
  // A highlighted passage must quote its span verbatim. Cite buttons/links
  // show the reference itself (ev_x [a–b]) and are checked for range only.
  if (el.tagName === "MARK") {
    const span = text.slice(start, end);
    if (inner !== span) {
      fail(
        `${ev} [${start}-${end}]: mark text differs from the seeded span\n  page: "${inner}"\n  seed: "${span}"`,
      );
    }
  }
}
if (cited.length === 0) fail("no citations found; the parser or the page is broken");

// ---- 2. no citation outside the contract: every visible reference-shaped
// string sits inside an element carrying the checkable data attributes ----
const bodyText = document.body ? document.body.textContent : "";
const visibleRefs = (flatten(bodyText).match(/ev_\w+ (?:· )?\[\d+–\d+\]/g) ?? []).length;
if (visibleRefs !== checkedRefs) {
  fail(
    `${visibleRefs} reference-shaped citations on the page but ${checkedRefs} carry data-ev/data-span; every reference must be checkable`,
  );
}

// ---- 3. one DEMO_URL, and every demo link agrees with it ----
const urlDefs = [...html.matchAll(/var DEMO_URL = "([^"]+)"/g)];
if (urlDefs.length !== 1) {
  fail(`expected exactly one DEMO_URL definition, found ${urlDefs.length}`);
}
const demoUrl = urlDefs[0]?.[1];
const links = readFileSync(join(landingDir, "content", "links.ts"), "utf8");
const linksUrl = links.match(/DEMO_URL = "([^"]+)"/)?.[1];
if (demoUrl && linksUrl && demoUrl !== linksUrl) {
  fail(`DEMO_URL in served HTML (${demoUrl}) differs from content/links.ts (${linksUrl})`);
}
const demoLinks = [...document.querySelectorAll("[data-demo-link]")];
if (demoLinks.length === 0) fail("no [data-demo-link] anchors on the page");
for (const a of demoLinks) {
  const href = a.getAttribute("href");
  // a link may deep-link a route inside the demo, but the origin is always
  // the one DEMO_URL: "https://.../#/questions" passes, another host fails.
  if (href !== demoUrl && !(href ?? "").startsWith(`${demoUrl}/#/`)) {
    fail(`[data-demo-link] href "${href}" does not point at DEMO_URL "${demoUrl}"`);
  }
}

// ---- 4. the no-JS state is the finished document ----
// Without JS the page must already show the loop's end state: the decided
// fact at human confidence and the terminal transcript complete. These
// markers live in the server HTML, never behind a mounted gate.
if (!flatten(bodyText).includes("1.00 · human")) {
  fail('no-JS decided state missing: "1.00 · human" not in server HTML');
}
if (!flatten(bodyText).includes("4 task-scoped results")) {
  fail("no-JS terminal transcript missing: the finished run is not in server HTML");
}
// The js-class gate itself must exist in the shipped CSS.
const cssDir = join(outDir, "_next", "static", "css");
let css = "";
try {
  for (const f of readdirSync(cssDir)) css += readFileSync(join(cssDir, f), "utf8");
} catch {
  fail("no built CSS found under out/_next/static/css");
}
if (css && !css.includes("html.js")) {
  fail("html.js gating selectors missing from the built CSS; the no-JS contract is broken");
}

// ---- 5. overflow-x: an overflow-x hidden ancestor silently kills the pinned
// scene's position: sticky. clip is the only allowed value. ----
if (/overflow-x:\s*hidden/.test(css)) {
  fail("overflow-x: hidden found in built CSS; use overflow-x: clip (sticky killer)");
}

// ---- 6. first-load JS budget: 150KB gzip hard cap, measured from the
// artifact itself (every script the exported page actually loads) ----
const scriptSrcs = [...document.querySelectorAll("script[src]")]
  // noModule chunks (the polyfills) never load in a modern browser.
  .filter((s) => !s.hasAttribute("noModule") && !s.hasAttribute("nomodule"))
  .map((s) => s.getAttribute("src"))
  .filter((src) => src && src.startsWith("/_next/"));
let gzipTotal = 0;
for (const src of scriptSrcs) {
  const file = join(outDir, src.replace(/^\//, ""));
  try {
    if (statSync(file).isFile()) gzipTotal += gzipSync(readFileSync(file)).length;
  } catch {
    fail(`script referenced by the page not found in out/: ${src}`);
  }
}
const gzipKb = Math.round(gzipTotal / 1024);
if (gzipTotal > 150 * 1024) {
  fail(`first-load JS is ${gzipKb}KB gzip; the hard cap is 150KB`);
}

// ---- 7. the motion tokens in tokens.ts mirror globals.css exactly ----
const globals = readFileSync(join(landingDir, "app", "globals.css"), "utf8");
const tokens = readFileSync(join(landingDir, "content", "tokens.ts"), "utf8");
const durPairs = [
  ["press", "--dur-press"],
  ["base", "--dur"],
  ["settle", "--dur-settle"],
  ["rise", "--dur-rise"],
  ["sweep", "--dur-sweep"],
  ["lift", "--dur-lift"],
  ["spring", "--dur-spring"],
  ["relight", "--dur-relight"],
];
for (const [jsName, cssName] of durPairs) {
  const cssMs = globals.match(new RegExp(`${cssName}:\\s*(\\d+(?:\\.\\d+)?)ms`))?.[1];
  const jsS = tokens.match(new RegExp(`${jsName}: (\\d+(?:\\.\\d+)?)`))?.[1];
  if (!cssMs || !jsS) {
    fail(`duration token ${jsName}/${cssName} missing from globals.css or tokens.ts`);
  } else if (Math.round(Number(jsS) * 1000) !== Number(cssMs)) {
    fail(`duration token drift: ${cssName} is ${cssMs}ms but tokens.ts ${jsName} is ${jsS}s`);
  }
}
for (const [jsName, cssName] of [
  ["EASE_OUT", "--ease-out"],
  ["EASE_MARKER", "--ease-marker"],
  ["EASE_SPRING", "--ease-spring"],
]) {
  const cssBez = globals.match(new RegExp(`${cssName}: cubic-bezier\\(([^)]+)\\)`))?.[1];
  const jsBez = tokens.match(new RegExp(`${jsName} = \\[([^\\]]+)\\]`))?.[1];
  const norm = (s) =>
    s
      .split(",")
      .map((n) => Number(n.trim()))
      .join(",");
  if (!cssBez || !jsBez) {
    fail(`easing token ${jsName}/${cssName} missing from globals.css or tokens.ts`);
  } else if (norm(cssBez) !== norm(jsBez)) {
    fail(`easing token drift: ${cssName} is (${cssBez}) but tokens.ts ${jsName} is [${jsBez}]`);
  }
}

if (failures > 0) {
  console.error(`check-ids: ${failures} failure(s) across ${cited.length} citations`);
  process.exit(1);
}
console.log(
  `check-ids: ${cited.length} citations verified against the seed, ` +
    `first-load JS ${gzipKb}KB gzip, no-JS state complete. The page only cites real spans.`,
);
