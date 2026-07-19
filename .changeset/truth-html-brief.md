---
"@marrowhq/core": patch
"@marrowhq/cli": patch
---

`marrow truth --html` renders the maintenance brief as a self-contained HTML
artifact: the morning read a cron job can write to a file or drop into an email.
It is the same truth the console shows, in the same black-room language, so the
brief and the console never disagree. The document carries its own inline styles
and a light-theme override, uses system font stacks, and links to nothing
external, so it is safe to email and safe to open from disk. Gold stays action
only (the "what needs you" block and the console link); every status carries a
glyph and a label, not colour alone. Set `MARROW_CONSOLE_URL` to turn the footer
into a link back to the room. The core render (`renderTruthHtml`) is a pure,
deterministic function.
