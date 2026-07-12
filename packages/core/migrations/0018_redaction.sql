-- 0018: the one visible exception to append-only evidence. A secret that
-- slipped past the pre-append scrub is immortal otherwise: evidence has no
-- update or delete path by design. Redaction overwrites ONE row's payload
-- with a fixed tombstone while the row itself (id, source, created_at, every
-- citation) survives, the reason is stamped here, and a normal append-only
-- audit evidence row records that it happened. Human-only at the CLI; there
-- is deliberately no MCP path, so no agent and no instruction embedded in
-- retrieved memory can ever trigger destruction.

alter table evidence add column if not exists redacted_at timestamptz;
alter table evidence add column if not exists redacted_reason text;
