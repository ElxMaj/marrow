# Releasing Marrow

The open-source core ships to npm so `npx @marrowhq/cli` and `npx -y @marrowhq/mcp-server` work from a clean machine. The packages exist under the `@marrowhq` scope. A new release still needs npm publish credentials.

## What is in place

- The `cli` package exposes a `marrow` bin (`packages/cli/src/main.ts`, built to `dist/main.js` with a shebang).
- The `mcp-server` package exposes a `marrow-mcp` bin (`packages/mcp-server/src/main.ts`, built to `dist/main.js` with a shebang), so a published install runs as `npx -y @marrowhq/mcp-server` for `claude mcp add`.
- Changesets drives a single coordinated version bump across the public packages: `@marrowhq/shared`, `@marrowhq/core`, `@marrowhq/mcp-server`, `@marrowhq/cli`, and `@marrowhq/web` (the `fixed` group in `.changeset/config.json`).
- `.github/workflows/release.yml` builds and runs `changeset publish` on a tagged release (`v*`) only, never on a normal merge.
- `LICENSE` (Apache-2.0) and `NOTICE` at the root; `license` + `repository` in each public package.

## Before the next publish (open items)

1. Add an `NPM_TOKEN` repo secret with publish rights: an npm **Automation** token (2FA-exempt) scoped to the `marrowhq` org, so CI can publish without a one-time password.
2. Confirm `npm view @marrowhq/cli version` matches the package version after the release. If npm latest lags `package.json`, `npx @marrowhq/cli` runs the older published build.
3. Run `pnpm launch:preflight`; see [Launch readiness](./launch.md) for the full account and domain checklist.

## Cutting a release

```bash
pnpm changeset            # describe the change
pnpm changeset version    # bump versions + changelogs (the public packages move together)
git commit -am "release" && git tag v0.4.0 && git push --follow-tags
# the release workflow builds and publishes on the tag
```

## Verify locally

```bash
pnpm -r build
(cd packages/cli && pnpm pack --pack-destination /tmp)
```

Note: a packed CLI tarball depends on `@marrowhq/core` and `@marrowhq/shared`; `npx @marrowhq/cli` works once those are published together (changesets handles the coordinated release and rewrites `workspace:*` to real versions).
