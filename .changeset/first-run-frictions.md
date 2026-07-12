---
"@marrowhq/cli": patch
"@marrowhq/core": patch
---

The last two first-run frictions.

Copying .env.example to .env, the reflex every dev tool trains, silently did
nothing: the CLI now loads ./.env when DATABASE_URL is unset (never
overriding a set variable, never failing on a missing file, one dim
confirmation line). And the missing-DATABASE_URL hint is demo-aware: demo
sets up its own schema, so its remedy no longer points at marrow migrate,
while other commands also suggest marrow doctor, whose remedy now names the
exact compose URL from a clone.
