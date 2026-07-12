# The Marrow design language: the black room

Marrow's surfaces are a control room at night. A cold near-black shell, bone ink, and one light source: marrow-gold. Gold is literal (the color of marrow inside bone), which is why it cannot read as another vendor's accent. Everything below is enforceable, and the token spine in `packages/web/src/styles.css` (`:root`) is the single source of truth; the landing mirrors the same spine. If a change is not expressible as a token change plus a stated exception, it does not belong in the language.

## The shell

Dark is the brand default. Surfaces step lighter than the page (the reading-room choice), depth comes from 1px hairline borders, never from shadow or glow.

| Token | Value | Role |
| --- | --- | --- |
| `--paper` | `#08090b` | page background, cold near-black |
| `--surface` | `#0e1013` | card, panel |
| `--surface-2` | `#13161a` | raised: provenance panel, modal |
| `--surface-3` | `#191d22` | hover, selected row |
| `--line` | `#1e2227` | hairline divider, default border |
| `--line-strong` | `#2c313a` | prominent border |
| `--ink` | `#e8e6e1` | primary text, bone (never pure white) |
| `--ink-muted` | `#a3a19a` | secondary text, labels |
| `--ink-faint` | `#85837c` | tertiary, mono meta |

The console keeps a light theme (`[data-theme="light"]`) and it stays warm bone paper (`--paper #f4efe4`), never white. The landing is dark only.

## The one light source

Marrow-gold (`--gold-500 #d8a657`, `--accent`) is for action only: buttons, links, focus ring, selection, the provenance rule, the promotion moment. Gold NEVER encodes a status.

Gold as a glow is rationed. Each surface gets its enumerated uses and nothing more. On the console: the mark's faint dark-mode glow, and the living map's hover and active node halo. On the landing: the scarcity list documented in its own stylesheet (beam, stamp underglow, caret, scanline, horizon, focus). Adding a new glow is a design decision to be argued, not a default.

## The three voices

| Face | Token | Job |
| --- | --- | --- |
| Archivo Variable (wght + wdth) | `--font-display` | decided truth and titles. The width axis plants it: `font-stretch` 116 to 118 percent, weight 620 to 660 |
| Geist Variable | `--font-sans` | all working UI prose. Weights cap at 560, hierarchy comes from size and ink, not bold |
| Geist Mono Variable | `--font-mono` | the evidence voice: every id, span offset `[start-end]`, confidence numeral, source label |

Display-for-decided is the ritual: an open fact sits in the working sans voice, and the moment a human promotes it, its title settles into the display face. The `.face-serif` classname is the settle contract from the Fraunces era; it stays, only the face behind it changed. Fonts are self-hosted through `@fontsource-variable` packages; no font hotlinking anywhere.

## Status is semantic, never gold

| Status | Hue | Value |
| --- | --- | --- |
| decided | sage | `#8bb88a` |
| open | honey amber | `#e3a24a` (deliberately off the gold hue) |
| contested | warm clay | `#d98a73` (the only red, reads as tension, not failure) |
| superseded, dismissed | taupe | `#8b897f` |

Every status renders as color plus a drawn glyph plus a text label, never color alone.

## Motion

Named curves only: `--ease-out` for entrances and state changes, `--ease-marker` for sweeps, `--ease-spring` reserved for exactly one beat, the open-to-decided promotion. Durations come off the ladder (`--dur-press 140ms` up to `--dur-spring 700ms`); any duration off the ladder is a stated decision. Animate transform and opacity only. Everything sits behind `prefers-reduced-motion`. Pressables get `scale(0.97)` on `:active`.

## The forbidden list

No purple or blue gradients. No glassmorphism. No emoji or sparkle in product UI. No rainbow status sets. No cold pure grays or pure white text. No second accent. No bold-for-hierarchy. No uniform 8px radius on everything. No shadow-for-depth outside the enumerated overlay and console shadows. No dependency for visualization: the graph is hand-rolled SVG. No Google Fonts hotlink. Sentence case, plain language, no em dashes.

## Changing the language

Tokens first: if you are typing a hex value outside the `:root` ramps, stop. New surfaces inherit the spine before earning exceptions. Any change to a UI surface is verified in a real browser (both console themes, reduced motion on and off) before it is called done, and both themes hold Lighthouse Accessibility 100.
