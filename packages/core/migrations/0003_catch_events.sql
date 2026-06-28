-- PR-17: catch instrumentation. An append-only log of every drift surface event
-- so precision, recall, and retention can be measured. It never mutates
-- evidence or distilled nodes; it only records what the catch did.

create table if not exists catch_events (
  id          bigserial primary key,
  event_type  text not null check (event_type in ('catch_surfaced','catch_acted_on','catch_dismissed')),
  question_id text references question(id),
  decision_id text references decision(id),
  repo_path   text,
  diff_span   jsonb,
  trigger     text not null,
  synthetic   boolean not null default false,
  model_used  text,
  confidence  double precision,
  created_at  timestamptz not null default now()
);

create index if not exists catch_events_question_idx on catch_events(question_id);
create index if not exists catch_events_decision_idx on catch_events(decision_id);
create index if not exists catch_events_type_idx on catch_events(event_type, synthetic, created_at);

-- dismissed is a terminal status for questions that are human-marked as noise.
-- it is intentionally added only to the question check constraint.
alter table question drop constraint if exists question_status_check;
alter table question add constraint question_status_check
  check (status in ('open', 'decided', 'contested', 'superseded', 'dismissed'));
