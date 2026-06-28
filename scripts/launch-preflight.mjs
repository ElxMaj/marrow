#!/usr/bin/env node
import { execFile } from "node:child_process";
import { resolve4, resolveCname, resolveNs, resolveSoa } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));

const checks = [];

function pass(name, detail) {
  checks.push({ status: "pass", name, detail });
}

function warn(name, detail) {
  checks.push({ status: "warn", name, detail });
}

function fail(name, detail) {
  checks.push({ status: "fail", name, detail });
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
    "ElxMaj/marrow",
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

  const secrets = await run("gh", ["secret", "list", "--repo", "ElxMaj/marrow"]);
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
      continue;
    }
    const latest = JSON.parse(viewed.stdout);
    if (latest === pkg.version) pass(`npm latest ${pkg.name}`, latest);
    else fail(`npm latest ${pkg.name}`, `registry has ${latest}, repo has ${pkg.version}`);
  }
}

async function fetchText(url) {
  const response = await fetch(url, { redirect: "follow" });
  const text = await response.text();
  return { response, text };
}

async function checkLiveSite() {
  const home = await fetchText("https://marrow-six.vercel.app/");
  if (home.response.ok) pass("launch site", `HTTP ${home.response.status}`);
  else fail("launch site", `HTTP ${home.response.status}`);

  const html = home.text;
  if (html.includes('rel="canonical" href="https://marrow-six.vercel.app/"')) {
    pass("canonical URL", "points at the live Vercel alias");
  } else {
    fail("canonical URL", "missing or stale canonical URL");
  }
  if (html.includes("None of it reaches the agent")) {
    pass("hero capitalization", "None is capitalized in the hero copy");
  } else {
    fail("hero capitalization", "hero copy does not contain the approved sentence");
  }

  const sitemap = await fetch("https://marrow-six.vercel.app/sitemap.xml");
  if (sitemap.ok) pass("sitemap", `HTTP ${sitemap.status}`);
  else fail("sitemap", `HTTP ${sitemap.status}`);

  const inspect = await run("vercel", ["inspect", "https://marrow-six.vercel.app"]);
  const inspectText = `${inspect.stdout}\n${inspect.stderr}`;
  if (!inspect.ok) warn("Vercel inspect", `could not inspect deployment: ${inspect.stderr}`);
  else if (inspectText.includes("Ready")) {
    pass("Vercel inspect", "deployment is inspectable");
  } else {
    warn("Vercel inspect", "deployment inspected, but readiness was not parsed");
  }
}

async function checkDomain() {
  try {
    const [nameservers, soa] = await Promise.all([
      resolveNs("marrowhq.com"),
      resolveSoa("marrowhq.com"),
    ]);
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
        "marrowhq.com is on Namecheap's failed WHOIS/contact-verification nameservers; verify domain contact details before changing Vercel DNS",
      );
    }
  } catch {
    // The A/CNAME checks below carry the actionable failure if NS/SOA lookup is unavailable.
  }

  try {
    const addresses = await resolve4("marrowhq.com");
    if (addresses.includes("76.76.21.21")) {
      pass("marrowhq.com DNS", "apex points at Vercel");
    } else {
      fail("marrowhq.com DNS", `apex A records are ${addresses.join(", ") || "missing"}`);
    }
  } catch (error) {
    fail("marrowhq.com DNS", error.message);
  }

  try {
    const cnames = await resolveCname("www.marrowhq.com");
    if (cnames.some((name) => name.replace(/\.$/, "") === "cname.vercel-dns.com")) {
      pass("www.marrowhq.com DNS", "www points at Vercel");
    } else {
      fail("www.marrowhq.com DNS", `www CNAME records are ${cnames.join(", ") || "missing"}`);
    }
  } catch (error) {
    fail("www.marrowhq.com DNS", error.message);
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
  await checkNpm();
  await checkLiveSite();
  await checkDomain();
  await checkBenchmarkAndClaims();
  await checkPackageFiles();

  console.log("Marrow launch preflight");
  for (const check of checks) {
    const label = check.status.toUpperCase().padEnd(4);
    console.log(`${label} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
  }

  const failed = checks.filter((check) => check.status === "fail");
  const warned = checks.filter((check) => check.status === "warn");
  console.log("");
  console.log(
    `${failed.length} failed, ${warned.length} warned, ${checks.length - failed.length - warned.length} passed`,
  );
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
