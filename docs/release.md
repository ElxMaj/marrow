# Releasing Marrow

The open-source core ships to npm so `npx @marrowhq/cli` and `npx -y @marrowhq/mcp-server` work from a clean machine. Publishing is set up but intentionally not yet enabled.

## What is in place

- The `cli` package exposes a `marrow` bin (`packages/cli/src/main.ts`, built to `dist/main.js` with a shebang).
- The `mcp-server` package exposes a `marrow-mcp` bin (`packages/mcp-server/src/main.ts`, built to `dist/main.js` with a shebang), so a published install runs as `npx -y @marrowhq/mcp-server` for `claude mcp add`.
- Changesets drives a single coordinated version bump across the public packages: `@marrowhq/shared`, `@marrowhq/core`, `@marrowhq/mcp-server`, `@marrowhq/cli`, and `@marrowhq/web` (the `fixed` group in `.changeset/config.json`).
- `.github/workflows/release.yml` builds and runs `changeset publish` on a tagged release (`v*`) only, never on a normal merge.
- `LICENSE` (Apache-2.0) and `NOTICE` at the root; `license` + `repository` in each public package.

## Before the first publish (open items)

1. Secure the npm org and scope: the org is `marrowhq` and the scope is `@marrowhq` (the unscoped `marrow` name is already taken on npm). The CLI resolves as `npx @marrowhq/cli`; the MCP server as `npx -y @marrowhq/mcp-server`.
2. Add an `NPM_TOKEN` repo secret with publish rights: an npm **Automation** token (2FA-exempt) scoped to the `marrowhq` org, so CI can publish without a one-time password.

## Cutting a release (once enabled)

```bash
pnpm changeset            # describe the change
pnpm changeset version    # bump versions + changelogs (the public packages move together)
git commit -am "release" && git tag v0.1.0 && git push --tags
# the release workflow builds and publishes on the tag
```

## Verify locally

```bash
pnpm -r build
npm pack --workspace packages/cli   # inspect the tarball: dist/main.js + the marrow bin
```

Note: a packed CLI tarball depends on `@marrowhq/core` and `@marrowhq/shared`; `npx @marrowhq/cli` works once those are published together (changesets handles the coordinated release and rewrites `workspace:*` to real versions).
