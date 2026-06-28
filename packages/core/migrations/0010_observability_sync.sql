-- Observability and connector sync. One Postgres still: the trace of every
-- model/retrieval/sync operation and the connectors' incremental state live as
-- tables next to the graph. No Langfuse service, no Temporal, no broker.

-- An append-only trace of one operation: distill, search, drift, a connector
-- sync, or an ingest. Recorded once at completion and never mutated, so the
-- pipeline is measurable (latency, tokens, cost, errors) without a second
-- system. This is not evidence, but like a log line it is never edited.
create table if not exists run (
  id             text primary key,
  kind           text not null check (kind in ('distill','search','drift','connector_sync','ingest')),
  status         text not null check (status in ('ok','error')),
  label          text,
  model          text,
  tokens_in      integer,
  tokens_out     integer,
  cost_usd       double precision,
  latency_ms     integer not null,
  input_summary  text,
  output_summary text,
  error          text,
  parent_id      text,
  metadata       jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists run_kind_created_idx on run (kind, created_at desc);
create index if not exists run_created_idx on run (created_at desc);
create index if not exists run_status_idx on run (status);

-- the incremental sync state for each live connector. mutable on purpose: the
-- cursor advances on every successful run so a connector only pulls what is
-- new. not evidence; this is the bookmark, not the substrate.
create table if not exists connector_state (
  name            text primary key,
  cursor          timestamptz,
  last_run_at     timestamptz,
  last_status     text not null default 'never' check (last_status in ('ok','error','never')),
  last_error      text,
  items_last_run  integer,
  total_items     integer not null default 0,
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- which connectors are configured for this brain and their settings. the
-- non-secret fields live in `settings` as jsonb; the secret (token, api key) is
-- stored as ciphertext in `secret_cipher`, never in plaintext settings. the
-- brain's own Postgres holds this, next to the state it drives.
create table if not exists connector_config (
  name            text primary key,
  kind            text not null,
  enabled         boolean not null default true,
  settings        jsonb not null default '{}'::jsonb,
  secret_cipher   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- speed up the connector dedup check: "has this exact source already been
-- ingested as evidence?" runs on every connector item. This indexes evidence
-- for lookup by source; it does not constrain or mutate evidence (still append
-- only, still no unique constraint that could reject a legitimate re-drop).
create index if not exists evidence_source_idx on evidence (source);
