---
"@marrowhq/web": patch
---

A real HTTP error surface for the console API: client mistakes answer typed 4xx with clean messages in one JSON envelope (400 invalid JSON or bad payload, 404 unknown route or missing id, 405 wrong verb with the Allow header, 413 oversize body) instead of a 500 leaking the internal error string. Unexpected errors log server-side and answer a generic 500. HEAD reads as GET with the body suppressed, and a trailing slash on an API route is the same route.
