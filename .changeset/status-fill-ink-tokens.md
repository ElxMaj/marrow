---
"@marrowhq/web": patch
---

Tokenize the two remaining raw-hex colours in the console (`.toast` and
`.chip.warn.active`) as theme-aware `--decided-ink` / `--contested-ink`. This
closes the last "no hex outside :root" slop-audit exception and fixes two real
AA contrast bugs it was hiding: the promote toast was dark ink on the dark
forest decided fill in the light theme, and the active warn chip was white on
the light salmon contested fill in the dark theme. Both now read dark-on-light
or bone-on-dark per theme, verified in a real browser.
