import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPreflightReport,
  evaluateDemoDocsTruth,
  evaluateHeroSourcePath,
  evaluateLiveSourceSetupPath,
  evaluateSourceSetupPath,
  formatMarkdownReport,
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

test("domain handoff separates Vercel access from registrar holds", () => {
  const report = buildPreflightReport([
    {
      status: "fail",
      name: "Vercel domain access",
      detail: "marrowhq.com is not visible to Vercel",
    },
    {
      status: "fail",
      name: "Namecheap domain verification",
      detail: "marrowhq.com is on failed WHOIS nameservers",
    },
  ]);

  const vercelAction = report.nextActions.find((action) => action.check === "Vercel domain access");
  const holdAction = report.nextActions.find(
    (action) => action.check === "Namecheap domain verification",
  );
  assert.match(vercelAction?.action ?? "", /Add marrowhq\.com to the Vercel project/);
  assert.doesNotMatch(vercelAction?.action ?? "", /registrar|WHOIS|hold/i);
  assert.match(holdAction?.action ?? "", /Verify the marrowhq\.com domain contact details/);
});

test("preflight report can render a paste-ready markdown handoff", () => {
  const report = buildPreflightReport(
    [
      {
        status: "fail",
        name: "NPM_TOKEN secret",
        detail: "missing repo secret, tagged releases cannot publish",
      },
      { status: "pass", name: "demo link", detail: "points at on-page #start" },
    ],
    {
      githubRepo: "ElxMaj/marrow",
      siteUrl: "https://marrow-six.vercel.app/",
      apexDomain: "marrowhq.com",
      wwwDomain: "www.marrowhq.com",
    },
  );

  const markdown = formatMarkdownReport(report);
  assert.match(markdown, /^## Marrow launch preflight/m);
  assert.match(markdown, /\*\*Summary:\*\* 1 failed, 0 warned, 1 passed, 2 total\./);
  assert.match(markdown, /### Open launch actions/);
  assert.match(markdown, /- \*\*NPM_TOKEN secret\*\* \(fail\): missing repo secret/);
  assert.match(markdown, /Action: Create an npm Automation token/);
  assert.match(markdown, /```bash\ngh secret set NPM_TOKEN --repo ElxMaj\/marrow\n```/);
  assert.match(markdown, /### Passed checks/);
  assert.match(markdown, /- \*\*demo link\*\*: points at on-page #start/);
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

test("demo docs describe the current bundled hero slice", () => {
  const staleDocs = {
    readme: "demo shows the magic-link decision decided with provenance",
    demoDoc:
      "pnpm demo ingests packages/core/fixtures/demo/pfc-gdynia.md and prints magic links, no shared passwords",
  };
  const currentDocs = {
    readme: "demo shows the soft-delete decision decided with provenance",
    demoDoc:
      "pnpm demo ingests packages/core/fixtures/demo/design-partner.md and prints soft delete, 30 days, then purge",
  };

  assert.equal(evaluateDemoDocsTruth(staleDocs).ok, false);
  assert.match(evaluateDemoDocsTruth(staleDocs).detail, /stale magic-link demo copy/);
  assert.deepEqual(evaluateDemoDocsTruth(currentDocs), {
    ok: true,
    detail: "demo docs match the bundled soft-delete slice",
  });
});

test("source setup includes migrations before the demo command", () => {
  const staleSetup = {
    readme: `pnpm install
pnpm db:up
pnpm marrow demo`,
    landing: `<button data-copy="pnpm install && pnpm db:up"></button>
<button data-copy="pnpm marrow demo"></button>`,
  };
  const currentSetup = {
    readme: `pnpm install
pnpm db:up
pnpm db:migrate
pnpm marrow demo`,
    landing: `<button data-copy="pnpm install && pnpm db:up"></button>
<button data-copy="pnpm db:migrate"></button>
<button data-copy="pnpm marrow demo"></button>`,
  };

  assert.equal(evaluateSourceSetupPath(staleSetup).ok, false);
  assert.match(evaluateSourceSetupPath(staleSetup).detail, /missing pnpm db:migrate/);
  assert.deepEqual(evaluateSourceSetupPath(currentSetup), {
    ok: true,
    detail: "source setup migrates before demo",
  });
});

test("live source setup proves the deployed landing includes migrations", () => {
  const staleLive = `<button data-copy="pnpm install && pnpm db:up"></button>
<button data-copy="pnpm marrow demo"></button>`;
  const currentLive = `<button data-copy="pnpm install && pnpm db:up"></button>
<button data-copy="pnpm db:migrate"></button>
<button data-copy="pnpm marrow demo"></button>`;

  assert.equal(evaluateLiveSourceSetupPath(staleLive).ok, false);
  assert.match(
    evaluateLiveSourceSetupPath(staleLive).detail,
    /live landing missing pnpm db:migrate/,
  );
  assert.deepEqual(evaluateLiveSourceSetupPath(currentLive), {
    ok: true,
    detail: "live landing source setup migrates before demo",
  });
});
