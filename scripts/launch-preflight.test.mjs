import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPreflightReport,
  evaluateHeroSourcePath,
  formatTextReport,
} from "./launch-preflight.mjs";

test("preflight report includes concrete next actions for launch blockers", () => {
  const report = buildPreflightReport([
    { status: "pass", name: "demo link", detail: "points at on-page #start" },
    {
      status: "fail",
      name: "NPM_TOKEN secret",
      detail: "missing repo secret, tagged releases cannot publish",
    },
    {
      status: "fail",
      name: "Namecheap domain verification",
      detail: "marrowhq.com is on Namecheap's failed WHOIS/contact-verification nameservers",
    },
  ]);

  assert.equal(report.summary.failed, 2);
  assert.equal(report.summary.passed, 1);
  assert.deepEqual(
    report.nextActions.map((action) => action.check),
    ["NPM_TOKEN secret", "Namecheap domain verification"],
  );
  assert.match(report.nextActions[0].command ?? "", /gh secret set NPM_TOKEN/);
  assert.match(report.nextActions[1].action, /Verify the marrowhq\.com domain contact details/);

  const text = formatTextReport(report);
  assert.match(text, /Next actions/);
  assert.match(text, /NPM_TOKEN secret/);
  assert.match(text, /Namecheap domain verification/);
});

test("preflight report is stable JSON for automation", () => {
  const report = buildPreflightReport([
    { status: "warn", name: "Vercel inspect", detail: "deployment inspected" },
  ]);

  const parsed = JSON.parse(JSON.stringify(report));
  assert.equal(parsed.summary.warned, 1);
  assert.equal(parsed.nextActions.length, 1);
  assert.equal(parsed.nextActions[0].severity, "warn");
});

test("preflight next actions respect the checked repository context", () => {
  const report = buildPreflightReport(
    [{ status: "fail", name: "GitHub CI", detail: "latest main run failed" }],
    {
      githubRepo: "ElxMaj/marrow-internal",
      siteUrl: "https://marrow-six.vercel.app/",
      apexDomain: "marrowhq.com",
      wwwDomain: "www.marrowhq.com",
    },
  );

  assert.equal(
    report.nextActions[0].command,
    "gh run list --repo ElxMaj/marrow-internal --branch main --workflow ci --limit 1",
  );
});

test("hero source path points evaluators at the full setup instead of a half-command", () => {
  const oldHero = `<section class="cover">
    <button type="button" class="cmd-chip" data-copy="pnpm marrow demo">
      <span class="cmd-text">pnpm marrow demo</span>
    </button>
  </section>`;
  const newHero = `<section class="cover">
    <a class="btn btn-primary" href="#start">Run from source</a>
  </section>`;

  assert.equal(evaluateHeroSourcePath(oldHero).ok, false);
  assert.match(evaluateHeroSourcePath(oldHero).detail, /before the source setup/);
  assert.deepEqual(evaluateHeroSourcePath(newHero), {
    ok: true,
    detail: "hero points at source setup",
  });
});
