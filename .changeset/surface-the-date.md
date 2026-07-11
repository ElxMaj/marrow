---
"@marrowhq/core": minor
"@marrowhq/cli": minor
"@marrowhq/web": minor
---

Surface the date: dated provenance and stale-fact flags.

Every citation now carries the source date. `trace_to_source` spans gain `createdAt` (when the evidence was captured), so a fact reads as claim plus source plus date. The CLI shows a "verified" date on human-promoted facts, and the console source panel and its copied citation carry the source date.

Facts also announce staleness. A new `isFactStale` helper marks a decided fact that is past its expiry, or (with no expiry) older than the staleness window, as stale but still safe to build. Task briefs carry `verifiedAt` and a `stale` flag, the CLI shows "stale, reverify", and `marrow truth` adds a next action to reverify decided facts that may be stale. `MARROW_STALE_DAYS` tunes the window (default 365).
