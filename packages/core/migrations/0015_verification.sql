-- 0015: the skeptic's verdicts. An append-only log of every verification of a
-- proposed fact, modeled on catch_events. The skeptic attacks a model-proposed
-- node and records whether it survived or was flagged, and why. It NEVER mutates
-- the node: a verdict is advisory, exactly like a catch. "agent proposes, human
-- promotes" is unchanged; the skeptic only annotates and, on a contradiction,
-- raises a normal question a human still answers.
create table if not exists verification (
  id         bigserial primary key,
  node_id    text not null,
  node_kind  text not null check (node_kind in ('entity', 'decision', 'question', 'goal')),
  verdict    text not null check (verdict in ('survived', 'flagged')),
  reasons    text[] not null default '{}',
  model_used text,
  created_at timestamptz not null default now()
);

create index if not exists verification_node_idx on verification (node_id, created_at);
