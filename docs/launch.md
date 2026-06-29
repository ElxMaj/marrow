# Launch Readiness

Run this before any public launch push, tag, or announcement:

```bash
pnpm launch:preflight
```

The preflight checks the current public launch surface:

- latest GitHub main CI is green
- the release workflow reruns token, typecheck, lint, tests, packed smoke, and build before npm publish
- `NPM_TOKEN` exists for release publishing
- local npm auth works
- public npm package versions match the repo package versions
- the live Vercel alias is up and has the approved hero copy
- demo links point at a reachable destination
- live `npx @marrowhq/*` commands point at packages that match the repo versions
- `marrowhq.com` is visible to the Vercel account
- `marrowhq.com` and `www.marrowhq.com` point at Vercel
- `benchmark/report.json` is nonzero and public benchmark wording stays synthetic
- packed package allowlists exclude built test files

The human-facing adoption path lives in [Agent workflow](./agent-workflow.md). Update it whenever the CLI or MCP loop changes.

## Account Gates

These checks need account access and cannot be fixed in code alone.

### npm

Create an npm Automation token scoped to the `marrowhq` org, then add it as the `NPM_TOKEN` GitHub repo secret. After tagging a release, verify:

```bash
npm view @marrowhq/cli version
npm view @marrowhq/core version
npm view @marrowhq/mcp-server version
```

Each version must match the package version in this repo. If it does not, `npx @marrowhq/cli` and `npx -y @marrowhq/mcp-server` run stale code.

### Domain

First clear the registrar hold. Current DNS can show Namecheap contact-verification nameservers:

```text
failed-whois-verification.namecheap.com
verify-contact-details.namecheap.com
```

If those appear, sign in to Namecheap and verify the domain contact details before changing Vercel DNS. Vercel cannot own or serve the domain while the registrar is holding it.

Add `marrowhq.com` to the Vercel project, then update DNS:

```text
marrowhq.com      A      76.76.21.21
www.marrowhq.com  CNAME  cname.vercel-dns.com
```

Remove parked A records such as `198.54.117.242`. The launch is not on the real domain until DNS and Vercel ownership both pass.

## Release Flow

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test`
4. `pnpm -r build`
5. `pnpm smoke:packed`
6. `pnpm launch:preflight`
7. Create the changeset release commit and tag.
8. Watch the release workflow publish packages.
9. Rerun `pnpm launch:preflight` after npm and DNS propagation.

`pnpm smoke:packed` builds the workspace, packs the public packages, installs the tarballs into a disposable app, then verifies the CLI and MCP task/truth loop from the package artifacts.
