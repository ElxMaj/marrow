# packages/web

The console is the human surface of the brain. Its visual language is the black room, specified in `docs/design-language.md` at the repo root; read that first. Rules that bite in this package:

- The token spine at the top of `src/styles.css` (`:root` and `[data-theme="light"]`) is the only place a raw color may be defined. If you are typing a hex value in a view or component, stop and use a token.
- Dark is the brand: cold near-black shell, surfaces lighter than the page, 1px hairlines for depth. The light theme stays warm bone paper and must keep working; verify every change in both themes.
- Marrow-gold is action only (buttons, links, focus, selection, provenance rule, the promote moment). Status uses the sage/amber/clay/taupe hues and never gold, never color alone (always glyph plus label).
- The display face is Archivo Variable with the width axis (`font-stretch` 116 to 118 percent); it belongs to decided truth and titles only. `.face-serif` is the promote settle contract; do not rename it. Geist Mono is the evidence voice for ids, offsets, confidence, and sources.
- Motion: named curves and the duration ladder from the tokens; `--ease-spring` fires only on the open-to-decided promotion; transform and opacity only; everything respects `prefers-reduced-motion`.
- Visualization is dependency-free, hand-rolled SVG (the living map). No chart or graph libraries. Fonts come from `@fontsource-variable` packages, self-hosted, never hotlinked.
- The slop audit at the end of `docs/design-language.md` is a gate, not a suggestion: every console change runs it. The tells it catches (a grid of identical cards, a decorative gradient, a drop shadow for depth, bold-for-hierarchy, a second accent, hype copy) are exactly what make a UI read generated instead of made. If a screen would be indistinguishable from a hundred other AI dashboards, it is not done.
- Done means: `pnpm typecheck`, `pnpm lint`, root `pnpm test` green (`ℹ fail 0` exactly), the changed surface eyeballed in a real browser in both themes, and the slop audit passed.
