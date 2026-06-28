// The landing may only cite seeded facts, forever. Every <mark>/<button>/<a>
// carrying data-ev + data-span must point at a real span in the demo seed's
// room documents, and every highlighted passage must quote its span verbatim.
// Run: node landing/check-ids.mjs   (wired into the root test script)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "index.html"), "utf8");
const seed = readFileSync(join(here, "..", "packages", "web", "scripts", "seed-room.ts"), "utf8");
const coreDemo = readFileSync(join(here, "..", "packages", "core", "src", "demo.ts"), "utf8");

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

let failures = 0;
function fail(msg) {
  failures += 1;
  console.error(`check-ids: ${msg}`);
}

// Every data-ev citation on the page, with the element's inner text. The
// closing tag tolerates prettier's `</mark\n>` line-break style.
const CITE_RE =
  /<(\w+)[^>]*data-ev="([^"]+)"[^>]*data-span="(\d+)-(\d+)"[^>]*>([\s\S]*?)<\/\1\s*>/g;
let count = 0;
let checkedRefs = 0;
for (const [, tag, ev, startRaw, endRaw, innerRaw] of html.matchAll(CITE_RE)) {
  count += 1;
  const innerFlat = innerRaw
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/^ev_\w+ (?:· )?\[\d+–\d+\]$/.test(innerFlat)) checkedRefs += 1;
  const text = DOCS[ev];
  if (text === undefined) {
    fail(`${ev}: unknown evidence id (no seed document bound)`);
    continue;
  }
  const start = Number(startRaw);
  const end = Number(endRaw);
  if (!(start >= 0 && end > start && end <= text.length)) {
    fail(`${ev} [${start}-${end}]: span out of range for its document`);
    continue;
  }
  const span = text.slice(start, end);
  const inner = innerRaw
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // A highlighted passage must quote its span verbatim. Cite buttons/links
  // show the reference itself (ev_x [a–b]) and are checked for range only.
  if (tag === "mark" && inner !== span) {
    fail(
      `${ev} [${start}-${end}]: mark text differs from the seeded span\n  page: "${inner}"\n  seed: "${span}"`,
    );
  }
}
if (count === 0) fail("no citations found; the parser or the page is broken");

// The demo url is a single constant: one definition in the script, every link
// carries data-demo-link so the constant is the only source of truth.
const urls = html.match(/var DEMO_URL = "([^"]+)"/g) ?? [];
if (urls.length !== 1) fail(`expected exactly one DEMO_URL definition, found ${urls.length}`);

// No citation outside the contract: every visible `ev_x · [a–b]` reference on
// the page must sit inside an element carrying the checkable data attributes.
const REF_SHAPE = /ev_\w+ (?:· )?\[\d+–\d+\]/g;
const flat = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/\s+/g, " ");
const visibleRefs = (flat.match(REF_SHAPE) ?? []).length;
if (visibleRefs !== checkedRefs) {
  fail(
    `${visibleRefs} reference-shaped citations on the page but ${checkedRefs} carry data-ev/data-span; every reference must be checkable`,
  );
}

if (failures > 0) {
  console.error(`check-ids: ${failures} failure(s) across ${count} citations`);
  process.exit(1);
}
console.log(
  `check-ids: ${count} citations verified against the seed. The page only cites real spans.`,
);
