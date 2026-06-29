#!/usr/bin/env node
import { execFile } from "node:child_process";
import { resolve4, resolveCname, resolveNs, resolveSoa } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const githubRepo = process.env.MARROW_PREFLIGHT_REPO ?? "ElxMaj/marrow";
const siteUrl = process.env.MARROW_PREFLIGHT_SITE_URL ?? "https://marrow-six.vercel.app/";
const canonicalUrl = process.env.MARROW_PREFLIGHT_CANONICAL_URL ?? "https://marrow-six.vercel.app/";
const apexDomain = process.env.MARROW_PREFLIGHT_APEX_DOMAIN ?? "marrowhq.com";
const wwwDomain = process.env.MARROW_PREFLIGHT_WWW_DOMAIN ?? "www.marrowhq.com";
const defaultReportContext = { githubRepo, siteUrl, apexDomain, wwwDomain };

const checks = [];
const npmPackageProblems = new Map();

function pass(name, detail) {
  checks.push({ status: "pass", name, detail });
}

function warn(name, detail) {
  checks.push({ status: "warn", name, detail });
}

function fail(name, detail) {
  checks.push({ status: "fail", name, detail });
}

function nextActionFor(check, context = defaultReportContext) {
  if (check.status === "pass") return undefined;

  const base = { check: check.name, severity: check.status };
  const npmLatest = /^npm latest (.+)$/.exec(check.name);
  if (npmLatest) {
    return {
      ...base,
      action: `Publish ${npmLatest[1]} at the repo package version, then verify npm latest matches.`,
      command: `npm view ${npmLatest[1]} version`,
    };
  }

  if (check.name === "GitHub CI") {
    return {
      ...base,
      action: "Fix or rerun the latest main CI before launch.",
      command: `gh run list --repo ${context.githubRepo} --branch main --workflow ci --limit 1`,
    };
  }
  if (check.name === "NPM_TOKEN secret") {
    return {
      ...base,
      action:
        "Create an npm Automation token with publish rights for the marrowhq org, then add it to the public repo secrets.",
      command: `gh secret set NPM_TOKEN --repo ${context.githubRepo}`,
    };
  }
  if (check.name === "npm auth") {
    return {
      ...base,
      action:
        "Authenticate npm locally if publishing from this machine, or rely on the release workflow after NPM_TOKEN is set.",
      command: "npm login",
    };
  }
  if (check.name === "release workflow") {
    return {
      ...base,
      action: "Restore the release workflow guardrails before any tag can publish packages.",
      command: "sed -n '1,220p' .github/workflows/release.yml",
    };
  }
  if (check.name === "launch site") {
    return {
      ...base,
      action: "Repair the Vercel production alias before linking users to the launch site.",
      command: `vercel inspect ${context.siteUrl}`,
    };
  }
  if (check.name === "canonical URL") {
    return {
      ...base,
      action: "Update landing metadata so the canonical URL matches the live launch alias.",
    };
  }
  if (check.name === "hero capitalization") {
    return {
      ...base,
      action: "Restore the approved hero sentence with capitalized sentence starts.",
    };
  }
  if (check.name === "hero source path") {
    return {
      ...base,
      action:
        "Point the hero CTA at the full source setup section while npm latest still lags the repo.",
      command: 'rg -n "Run from source|cmd-chip|pnpm marrow demo" landing/index.html',
    };
  }
  if (check.name === "source setup migration") {
    return {
      ...base,
      action: "Add pnpm db:migrate to the source quickstart before the demo command.",
      command: 'rg -n "pnpm db:up|pnpm db:migrate|pnpm marrow demo" README.md landing/index.html',
    };
  }
  if (check.name === "live source setup migration") {
    return {
      ...base,
      action:
        "Redeploy the launch site after adding pnpm db:migrate to the source quickstart before the demo command.",
      command: `curl -fsSL ${context.siteUrl} | rg "pnpm db:up|pnpm db:migrate|pnpm marrow demo"`,
    };
  }
  if (check.name === "demo link") {
    return {
      ...base,
      action: "Point DEMO_URL at a reachable hosted demo or an existing on-page section.",
      command: 'rg -n "DEMO_URL|id=\\"start\\"" landing/index.html',
    };
  }
  if (check.name === "live npx freshness") {
    return {
      ...base,
      action:
        "Keep live copy source-first until npm latest matches the repo, or publish the current packages.",
      command: "pnpm launch:preflight",
    };
  }
  if (check.name === "sitemap") {
    return {
      ...base,
      action: "Restore the launch sitemap before public indexing or announcement traffic.",
    };
  }
  if (check.name === "Vercel inspect") {
    return {
      ...base,
      action:
        "Confirm the deployment is Ready in Vercel; warnings here can be transient but should be checked before launch.",
      command: `vercel inspect ${context.siteUrl}`,
    };
  }
  if (check.name === "Vercel domain access") {
    return {
      ...base,
      action: `Add ${context.apexDomain} to the Vercel project that serves ${context.siteUrl}, then rerun domain inspection.`,
      command: `vercel domains inspect ${context.apexDomain}`,
    };
  }
  if (check.name === "apex content") {
    return {
      ...base,
      action: `Point ${context.apexDomain} at the Vercel launch project and verify the homepage serves the agent launch page, not an old app.`,
      command: `curl -fsSL https://${context.apexDomain} | rg "product context layer|Your coding agent"`,
    };
  }
  if (check.name === "Namecheap domain verification") {
    return {
      ...base,
      action: `Verify the ${context.apexDomain} domain contact details in Namecheap, then wait for failed WHOIS nameservers to clear.`,
    };
  }
  if (check.name === `${context.apexDomain} DNS` || check.name === "marrowhq.com DNS") {
    return {
      ...base,
      action: "Set the apex A record to Vercel and remove parked Namecheap A records.",
      command: `${context.apexDomain} A 76.76.21.21`,
    };
  }
  if (check.name === `${context.wwwDomain} DNS` || check.name === "www.marrowhq.com DNS") {
    return {
      ...base,
      action: "Set the www CNAME to Vercel.",
      command: `${context.wwwDomain} CNAME cname.vercel-dns.com`,
    };
  }
  if (check.name === "benchmark report") {
    return {
      ...base,
      action: "Regenerate benchmark/report.json with nonzero, honest synthetic measurements.",
      command: "pnpm benchmark",
    };
  }
  if (check.name === "benchmark claims") {
    return {
      ...base,
      action:
        "Keep public benchmark wording synthetic and remove any partner-data implication unless real partner data exists.",
    };
  }
  if (check.name === "demo docs truth") {
    return {
      ...base,
      action: "Update README.md and docs/demo.md so the documented demo matches the bundled slice.",
      command:
        'rg -n "magic-link decision|pfc-gdynia|front-desk|soft-delete|design-partner" README.md docs/demo.md',
    };
  }
  if (check.name.startsWith("package files ")) {
    return {
      ...base,
      action: "Keep package allowlists excluding built tests before publishing.",
    };
  }

  return {
    ...base,
    action: "Resolve this launch preflight finding before public launch.",
  };
}

export function buildPreflightReport(sourceChecks, context = defaultReportContext) {
  const failed = sourceChecks.filter((check) => check.status === "fail");
  const warned = sourceChecks.filter((check) => check.status === "warn");
  const passed = sourceChecks.filter((check) => check.status === "pass");
  return {
    summary: {
      failed: failed.length,
      warned: warned.length,
      passed: passed.length,
      total: sourceChecks.length,
    },
    checks: sourceChecks,
    nextActions: sourceChecks
      .map((check) => nextActionFor(check, context))
      .filter((action) => action !== undefined),
  };
}

export function formatTextReport(report) {
  const lines = ["Marrow launch preflight"];
  for (const check of report.checks) {
    const label = check.status.toUpperCase().padEnd(4);
    lines.push(`${label} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
  }

  lines.push("");
  lines.push(
    `${report.summary.failed} failed, ${report.summary.warned} warned, ${report.summary.passed} passed`,
  );

  if (report.nextActions.length > 0) {
    lines.push("");
    lines.push("Next actions");
    report.nextActions.forEach((action, index) => {
      lines.push(`${index + 1}. ${action.check}: ${action.action}`);
      if (action.command) lines.push(`   ${action.command}`);
    });
  }

  return lines.join("\n");
}

export function formatMarkdownReport(report) {
  const lines = [
    "## Marrow launch preflight",
    "",
    `**Summary:** ${report.summary.failed} failed, ${report.summary.warned} warned, ${report.summary.passed} passed, ${report.summary.total} total.`,
  ];

  if (report.nextActions.length > 0) {
    lines.push("", "### Open launch actions");
    for (const action of report.nextActions) {
      const check = report.checks.find((item) => item.name === action.check);
      const detail = check?.detail ? `: ${check.detail}` : "";
      lines.push(`- **${action.check}** (${action.severity})${detail}`);
      lines.push(`  Action: ${action.action}`);
      if (action.command) {
        lines.push("", "```bash", action.command, "```");
      }
    }
  }

  const passed = report.checks.filter((check) => check.status === "pass");
  if (passed.length > 0) {
    lines.push("", "### Passed checks");
    for (const check of passed) {
      lines.push(`- **${check.name}**${check.detail ? `: ${check.detail}` : ""}`);
    }
  }

  return lines.join("\n");
}

export function evaluateHeroSourcePath(html) {
  const cover = html.match(/<section class="cover">([\s\S]*?)<\/section>/)?.[1];
  if (!cover) return { ok: false, detail: "missing cover section" };
  if (cover.includes('data-copy="pnpm marrow demo"')) {
    return {
      ok: false,
      detail: "hero copies pnpm marrow demo before the source setup",
    };
  }
  if (cover.includes('href="#start"') && cover.includes("Run from source")) {
    return { ok: true, detail: "hero points at source setup" };
  }
  return {
    ok: false,
    detail: "hero does not point at the source setup",
  };
}

export function evaluateDemoDocsTruth({ readme, demoDoc }) {
  const stale = [];
  if (/magic-link decision/i.test(readme)) stale.push("README says magic-link decision");
  if (/pfc-gdynia|front-desk|magic links, no shared passwords/i.test(demoDoc)) {
    stale.push("docs/demo.md says old magic-link slice");
  }
  if (stale.length > 0) {
    return {
      ok: false,
      detail: `stale magic-link demo copy: ${stale.join("; ")}`,
    };
  }

  if (
    /soft-delete decision/i.test(readme) &&
    demoDoc.includes("packages/core/fixtures/demo/design-partner.md") &&
    /soft delete, 30 days, then purge/i.test(demoDoc)
  ) {
    return { ok: true, detail: "demo docs match the bundled soft-delete slice" };
  }

  return {
    ok: false,
    detail: "demo docs do not prove the bundled soft-delete slice",
  };
}

function evaluateSourceSetupText(text, label) {
  const dbUp = text.indexOf("pnpm db:up");
  const migrate = text.indexOf("pnpm db:migrate");
  const demo = text.indexOf("pnpm marrow demo");
  if (dbUp < 0) return `${label} missing pnpm db:up`;
  if (migrate < 0) return `${label} missing pnpm db:migrate`;
  if (demo < 0) return `${label} missing pnpm marrow demo`;
  if (!(dbUp < migrate && migrate < demo)) {
    return `${label} must run pnpm db:migrate after pnpm db:up and before pnpm marrow demo`;
  }
  return undefined;
}

export function evaluateSourceSetupPath({ readme, landing }) {
  const problems = [
    evaluateSourceSetupText(readme, "README"),
    evaluateSourceSetupText(landing, "landing"),
  ].filter((problem) => problem !== undefined);
  if (problems.length > 0) {
    return {
      ok: false,
      detail: problems.join("; "),
    };
  }
  return { ok: true, detail: "source setup migrates before demo" };
}

export function evaluateLiveSourceSetupPath(html) {
  const problem = evaluateSourceSetupText(html, "live landing");
  if (problem) return { ok: false, detail: problem };
  return { ok: true, detail: "live landing source setup migrates before demo" };
}

export function evaluateApexProductTruth(html) {
  if (
    html.includes("Marrow · The product context layer for coding agents") &&
    html.includes("Your coding agent has never been in the room.")
  ) {
    return { ok: true, detail: "apex serves the agent launch page" };
  }

  return {
    ok: false,
    detail: "apex does not serve the agent launch page",
  };
}

async function run(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: root,
      maxBuffer: 1024 * 1024,
      ...options,
    });
    return { ok: true, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout?.trim() ?? "",
      stderr: error.stderr?.trim() ?? error.message,
    };
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

async function checkGitHub() {
  const runs = await run("gh", [
    "run",
    "list",
    "--repo",
    githubRepo,
    "--branch",
    "main",
    "--workflow",
    "ci",
    "--limit",
    "1",
    "--json",
    "status,conclusion,headSha",
  ]);
  if (!runs.ok) {
    fail("GitHub CI", `could not read latest main run: ${runs.stderr}`);
    return;
  }
  const [latest] = JSON.parse(runs.stdout);
  if (latest?.status === "completed" && latest.conclusion === "success") {
    pass("GitHub CI", `main is green at ${latest.headSha.slice(0, 7)}`);
  } else {
    fail(
      "GitHub CI",
      `latest main run is ${latest?.status ?? "missing"} / ${latest?.conclusion ?? "none"}`,
    );
  }

  const secrets = await run("gh", ["secret", "list", "--repo", githubRepo]);
  if (!secrets.ok) {
    fail("NPM_TOKEN secret", `could not list repo secrets: ${secrets.stderr}`);
    return;
  }
  if (secrets.stdout.split(/\n/).some((line) => line.split(/\s+/)[0] === "NPM_TOKEN")) {
    pass("NPM_TOKEN secret", "repo secret exists");
  } else {
    fail("NPM_TOKEN secret", "missing repo secret, tagged releases cannot publish");
  }
}

async function checkReleaseWorkflow() {
  const workflow = await readFile(join(root, ".github/workflows/release.yml"), "utf8");
  const publishIndex = workflow.indexOf("pnpm changeset publish");
  if (publishIndex === -1) {
    fail("release workflow", "missing pnpm changeset publish");
    return;
  }

  const requiredBeforePublish = [
    ["npm token check", 'test -n "$NODE_AUTH_TOKEN"'],
    ["typecheck", "pnpm typecheck"],
    ["lint", "pnpm lint"],
    ["test", "pnpm test"],
    ["packed smoke", "pnpm smoke:packed"],
    ["build", "pnpm -r build"],
  ];
  const missing = requiredBeforePublish
    .filter(([, command]) => {
      const index = workflow.indexOf(command);
      return index === -1 || index > publishIndex;
    })
    .map(([name]) => name);

  if (missing.length === 0) {
    pass(
      "release workflow",
      "checks token, typecheck, lint, tests, packed smoke, and build before publish",
    );
  } else {
    fail("release workflow", `missing before publish: ${missing.join(", ")}`);
  }
}

async function checkNpm() {
  const whoami = await run("npm", ["whoami"]);
  if (whoami.ok) pass("npm auth", `logged in as ${whoami.stdout}`);
  else fail("npm auth", "local npm is not authenticated");

  const packages = [
    "packages/shared/package.json",
    "packages/core/package.json",
    "packages/web/package.json",
    "packages/mcp-server/package.json",
    "packages/cli/package.json",
  ];
  for (const path of packages) {
    const pkg = await readJson(path);
    const viewed = await run("npm", ["view", pkg.name, "version", "--json"]);
    if (!viewed.ok) {
      fail(`npm latest ${pkg.name}`, viewed.stderr);
      npmPackageProblems.set(pkg.name, "could not read npm latest");
      continue;
    }
    const latest = JSON.parse(viewed.stdout);
    if (latest === pkg.version) pass(`npm latest ${pkg.name}`, latest);
    else {
      const detail = `registry has ${latest}, repo has ${pkg.version}`;
      fail(`npm latest ${pkg.name}`, detail);
      npmPackageProblems.set(pkg.name, detail);
    }
  }
}

async function fetchText(url) {
  const response = await fetch(url, { redirect: "follow" });
  const text = await response.text();
  return { response, text };
}

async function checkLiveSite() {
  const home = await fetchText(siteUrl);
  if (home.response.ok) pass("launch site", `HTTP ${home.response.status}`);
  else fail("launch site", `HTTP ${home.response.status}`);

  const html = home.text;
  if (html.includes(`rel="canonical" href="${canonicalUrl}"`)) {
    pass("canonical URL", `points at ${canonicalUrl}`);
  } else {
    fail("canonical URL", "missing or stale canonical URL");
  }
  if (html.includes("None of it reaches the agent")) {
    pass("hero capitalization", "None is capitalized in the hero copy");
  } else {
    fail("hero capitalization", "hero copy does not contain the approved sentence");
  }
  const heroSourcePath = evaluateHeroSourcePath(html);
  if (heroSourcePath.ok) pass("hero source path", heroSourcePath.detail);
  else fail("hero source path", heroSourcePath.detail);

  const liveSourceSetup = evaluateLiveSourceSetupPath(html);
  if (liveSourceSetup.ok) pass("live source setup migration", liveSourceSetup.detail);
  else fail("live source setup migration", liveSourceSetup.detail);

  const demoUrlMatch = html.match(/var DEMO_URL = "([^"]+)"/);
  const demoUrl = demoUrlMatch?.[1];
  if (!demoUrl) {
    fail("demo link", "missing DEMO_URL constant");
  } else if (demoUrl.startsWith("#")) {
    const id = demoUrl.slice(1);
    const hasAnchor = new RegExp(`id="${id}"`).test(html);
    if (hasAnchor) pass("demo link", `points at on-page ${demoUrl}`);
    else fail("demo link", `${demoUrl} does not match an on-page section`);
  } else {
    try {
      const demo = await fetch(demoUrl, { method: "HEAD", redirect: "follow" });
      if (demo.ok) pass("demo link", `HTTP ${demo.status}`);
      else fail("demo link", `${demoUrl} returned HTTP ${demo.status}`);
    } catch (error) {
      fail("demo link", error instanceof Error ? error.message : String(error));
    }
  }

  const advertisedNpxPackages = [
    ["@marrowhq/cli", "npx @marrowhq/cli"],
    ["@marrowhq/mcp-server", "npx -y @marrowhq/mcp-server"],
  ].filter(([, marker]) => html.includes(marker));
  const staleAdvertisedPackages = advertisedNpxPackages.filter(([name]) =>
    npmPackageProblems.has(name),
  );
  if (advertisedNpxPackages.length === 0) {
    pass("live npx freshness", "no @marrowhq npx commands advertised");
  } else if (staleAdvertisedPackages.length === 0) {
    pass(
      "live npx freshness",
      `${advertisedNpxPackages.map(([name]) => name).join(", ")} match repo versions`,
    );
  } else {
    fail(
      "live npx freshness",
      staleAdvertisedPackages
        .map(([name]) => `${name} (${npmPackageProblems.get(name)})`)
        .join("; "),
    );
  }

  const sitemap = await fetch(new URL("/sitemap.xml", siteUrl));
  if (sitemap.ok) pass("sitemap", `HTTP ${sitemap.status}`);
  else fail("sitemap", `HTTP ${sitemap.status}`);

  const inspect = await run("vercel", ["inspect", siteUrl]);
  const inspectText = `${inspect.stdout}\n${inspect.stderr}`;
  if (!inspect.ok) warn("Vercel inspect", `could not inspect deployment: ${inspect.stderr}`);
  else if (inspectText.includes("Ready")) {
    pass("Vercel inspect", "deployment is inspectable");
  } else {
    warn("Vercel inspect", "deployment inspected, but readiness was not parsed");
  }
}

async function checkDomain() {
  const vercelDomain = await run("vercel", ["domains", "inspect", apexDomain]);
  if (vercelDomain.ok) {
    pass("Vercel domain access", `${apexDomain} is visible to the Vercel account`);
  } else {
    const reason =
      vercelDomain.stderr
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith("Error:"))
        ?.replace(/^Error:\s*/, "") ?? `could not inspect ${apexDomain}`;
    fail("Vercel domain access", `${apexDomain} is not visible to Vercel: ${reason}`);
  }

  try {
    const [nameservers, soa] = await Promise.all([resolveNs(apexDomain), resolveSoa(apexDomain)]);
    const verificationRecords = [...nameservers, soa.nsname, soa.hostmaster].map((name) =>
      name.toLowerCase(),
    );
    if (
      verificationRecords.some(
        (name) =>
          name.includes("verify-contact-details.namecheap.com") ||
          name.includes("failed-whois-verification.namecheap.com"),
      )
    ) {
      fail(
        "Namecheap domain verification",
        `${apexDomain} is on Namecheap's failed WHOIS/contact-verification nameservers; verify domain contact details before changing Vercel DNS`,
      );
    }
  } catch {
    // The A/CNAME checks below carry the actionable failure if NS/SOA lookup is unavailable.
  }

  try {
    const addresses = await resolve4(apexDomain);
    if (addresses.includes("76.76.21.21")) {
      pass(`${apexDomain} DNS`, "apex points at Vercel");
    } else {
      fail(`${apexDomain} DNS`, `apex A records are ${addresses.join(", ") || "missing"}`);
    }
  } catch (error) {
    fail(`${apexDomain} DNS`, error.message);
  }

  try {
    const cnames = await resolveCname(wwwDomain);
    if (cnames.some((name) => name.replace(/\.$/, "") === "cname.vercel-dns.com")) {
      pass(`${wwwDomain} DNS`, "www points at Vercel");
    } else {
      fail(`${wwwDomain} DNS`, `www CNAME records are ${cnames.join(", ") || "missing"}`);
    }
  } catch (error) {
    fail(`${wwwDomain} DNS`, error.message);
  }

  try {
    const apex = await fetchText(`https://${apexDomain}/`);
    if (!apex.response.ok) {
      fail("apex content", `HTTP ${apex.response.status}`);
      return;
    }
    const productTruth = evaluateApexProductTruth(apex.text);
    if (productTruth.ok) pass("apex content", productTruth.detail);
    else fail("apex content", productTruth.detail);
  } catch (error) {
    fail("apex content", error instanceof Error ? error.message : String(error));
  }
}

async function checkBenchmarkAndClaims() {
  const report = await readJson("benchmark/report.json");
  if (report.baseline?.tokens > 0 && report.marrow?.avgTokens > 0 && report.ratio > 0) {
    pass("benchmark report", `ratio ${report.ratio}, baseline ${report.baseline.tokens} tokens`);
  } else {
    fail("benchmark report", "report is missing nonzero baseline, marrow tokens, or ratio");
  }

  const readme = await readFile(join(root, "README.md"), "utf8");
  const faq = await readFile(join(root, "docs/faq.md"), "utf8");
  if (readme.includes("synthetic golden set") && faq.includes("No partner-data benchmark")) {
    pass("benchmark claims", "synthetic evals are labeled and partner data is not implied");
  } else {
    fail("benchmark claims", "synthetic or partner-data wording is missing");
  }

  const demoDoc = await readFile(join(root, "docs/demo.md"), "utf8");
  const demoDocsTruth = evaluateDemoDocsTruth({ readme, demoDoc });
  if (demoDocsTruth.ok) pass("demo docs truth", demoDocsTruth.detail);
  else fail("demo docs truth", demoDocsTruth.detail);

  const landing = await readFile(join(root, "landing/index.html"), "utf8");
  const sourceSetup = evaluateSourceSetupPath({ readme, landing });
  if (sourceSetup.ok) pass("source setup migration", sourceSetup.detail);
  else fail("source setup migration", sourceSetup.detail);
}

async function checkPackageFiles() {
  const packages = [
    "packages/shared/package.json",
    "packages/core/package.json",
    "packages/web/package.json",
    "packages/mcp-server/package.json",
    "packages/cli/package.json",
  ];
  for (const path of packages) {
    const pkg = await readJson(path);
    if (pkg.files?.includes("!dist/**/*.test.*")) {
      pass(`package files ${pkg.name}`, "built tests are excluded");
    } else {
      fail(`package files ${pkg.name}`, "built tests are not excluded from packed files");
    }
  }
}

async function main() {
  await checkGitHub();
  await checkReleaseWorkflow();
  await checkNpm();
  await checkLiveSite();
  await checkDomain();
  await checkBenchmarkAndClaims();
  await checkPackageFiles();

  const report = buildPreflightReport(checks);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else if (process.argv.includes("--markdown")) {
    console.log(formatMarkdownReport(report));
  } else {
    console.log(formatTextReport(report));
  }
  if (report.summary.failed > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
