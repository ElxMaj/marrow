-- PR-02 initial schema. One Postgres: the graph lives as tables and pgvector
-- holds embeddings in the same database. The schema encodes the sacred
-- constraints directly.

create extension if not exists vector;

-- Raw, verbatim substrate. The root of all provenance. NO status column and no
-- updated_at: evidence is append only and never mutated.
create table if not exists evidence (
  id         text primary key,
  text       text not null,
  source     text not null,
  created_at timestamptz not null default now()
);

-- distilled node: a thing the product talks about.
create table if not exists entity (
  id                text primary key,
  name              text not null,
  description       text,
  status            text not null check (status in ('open', 'decided', 'contested', 'superseded')),
  confidence_value  double precision not null check (confidence_value >= 0 and confidence_value <= 1),
  confidence_source text not null check (confidence_source in ('model', 'human')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- distilled node: a choice the room made. `is_constraint` flags a hard
-- constraint (a Decision tag, not a separate kind). "constraint" is reserved.
create table if not exists decision (
  id                text primary key,
  title             text not null,
  rationale         text not null,
  is_constraint     boolean not null default false,
  status            text not null check (status in ('open', 'decided', 'contested', 'superseded')),
  confidence_value  double precision not null check (confidence_value >= 0 and confidence_value <= 1),
  confidence_source text not null check (confidence_source in ('model', 'human')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- distilled node: an open thread the question loop wants a human to settle.
create table if not exists question (
  id                text primary key,
  prompt            text not null,
  relates_to        text[] not null default '{}',
  status            text not null check (status in ('open', 'decided', 'contested', 'superseded')),
  confidence_value  double precision not null check (confidence_value >= 0 and confidence_value <= 1),
  confidence_source text not null check (confidence_source in ('model', 'human')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- every distilled node links to one or more exact evidence spans. the FK to
-- evidence is what makes "no fact without provenance" enforceable in the db: a
-- node with no provenance row is a node with no source.
create table if not exists provenance (
  id          bigserial primary key,
  node_id     text not null,
  node_kind   text not null check (node_kind in ('entity', 'decision', 'question')),
  evidence_id text not null references evidence (id),
  span_start  integer not null check (span_start >= 0),
  span_end    integer not null check (span_end >= span_start)
);
create index if not exists provenance_node_idx on provenance (node_id);
create index if not exists provenance_evidence_idx on provenance (evidence_id);

-- embeddings carry their model and dimension so a provider switch is detectable
-- and never silently corrupts the index. the `vector` column is intentionally
-- dimensionless: the dim is stored per row, not baked into the column width.
create table if not exists embedding (
  id              bigserial primary key,
  node_id         text not null,
  node_kind       text,
  embedding_model text not null,
  dim             integer not null check (dim > 0),
  vector          vector not null,
  created_at      timestamptz not null default now()
);
create index if not exists embedding_node_idx on embedding (node_id);
