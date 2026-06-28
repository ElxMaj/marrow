# Launch Readiness

Run this before any public launch push, tag, or announcement:

```bash
pnpm launch:preflight
```

The preflight checks the current public launch surface:

- latest GitHub main CI is green
- `NPM_TOKEN` exists for release publishing
- local npm auth works
- public npm package versions match the repo package versions
- the live Vercel alias is up and has the approved hero copy
- `marrowhq.com` and `www.marrowhq.com` point at Vercel
- `benchmark/report.json` is nonzero and public benchmark wording stays synthetic
- packed package allowlists exclude built test files

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
5. `pnpm launch:preflight`
6. Create the changeset release commit and tag.
7. Watch the release workflow publish packages.
8. Rerun `pnpm launch:preflight` after npm and DNS propagation.
