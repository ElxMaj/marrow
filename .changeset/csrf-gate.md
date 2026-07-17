---
"@marrowhq/web": patch
---

The local brain is not CSRF-able: API POSTs enforce same-origin (a cross-site Origin is refused with 403; MARROW_WEB_ALLOW_ORIGIN whitelists one origin for intentional proxied serving), body-carrying POSTs must be application/json (closing the no-preflight HTML-form vector), API JSON answers with cache-control no-store plus nosniff, and the SPA shell carries a same-origin CSP, X-Frame-Options DENY, and nosniff. curl and the console itself are unaffected.
