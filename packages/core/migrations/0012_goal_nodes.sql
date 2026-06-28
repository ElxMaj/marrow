-- PR-goals. The fifth distilled node kind: a goal, a target or outcome the room
-- committed to (product goals and user goals). Same discipline as every other
-- distilled node: status, confidence, provenance. Goals come from the room, not
-- the repo: entity_id links a goal to the feature/product it serves, never to
-- code.
create table if not exists goal (
  id                text primary key,
  title             text not null,
  description       text,
  goal_type         text not null check (goal_type in ('product', 'user')),
  entity_id         text references entity (id),
  status            text not null check (status in ('open', 'decided', 'contested', 'superseded')),
  confidence_value  double precision not null check (confidence_value >= 0 and confidence_value <= 1),
  confidence_source text not null check (confidence_source in ('model', 'human')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists goal_entity_idx on goal (entity_id);

-- provenance must accept the new kind so "no fact without provenance" still
-- holds for goals. drop the existing node_kind check by whatever name Postgres
-- gave it, then re-add it widened to include 'goal'. doing it this way is
-- robust to the auto-generated constraint name.
do $$
declare existing text;
begin
  select conname into existing
    from pg_constraint
   where conrelid = 'provenance'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%node_kind%';
  if existing is not null then
    execute format('alter table provenance drop constraint %I', existing);
  end if;
end $$;

alter table provenance add constraint provenance_node_kind_check
  check (node_kind in ('entity', 'decision', 'question', 'goal'));
