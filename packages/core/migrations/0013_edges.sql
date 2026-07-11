-- 0013: the knowledge graph edge. Still one Postgres: the graph is a table,
-- walked by a recursive CTE (store.neighbors), never a separate graph database.
-- An edge is NOT a fact about the product. It is a rule or model assertion about
-- how two distilled facts relate, so it carries a confidence and a source, and,
-- where a span justifies it, a link to that evidence. An edge NEVER carries a
-- status and NEVER promotes a node: "agent proposes, human promotes" is a
-- property of nodes. Edges are advisory structure so retrieval can walk the web
-- instead of only searching it, which is what makes the brain get stronger as it
-- grows instead of noisier.
--
-- from_id and to_id are bare node ids (like provenance.node_id), because an
-- endpoint can be any of the four distilled kinds and no single foreign key can
-- cover four tables. Only evidence_id gets a real FK, the same shape provenance
-- uses. Evidence is never an endpoint: it is the root of provenance, not part of
-- the distilled web.
create table if not exists edge (
  id           bigserial primary key,
  from_id      text not null,
  from_kind    text not null check (from_kind in ('entity', 'decision', 'question', 'goal')),
  to_id        text not null,
  to_kind      text not null check (to_kind   in ('entity', 'decision', 'question', 'goal')),
  relation     text not null check (relation in
                 ('concerns', 'serves', 'supersedes', 'refines', 'conflicts_with', 'relates_to')),
  confidence   double precision not null check (confidence >= 0 and confidence <= 1),
  source       text not null check (source in ('rule', 'model', 'human')),
  evidence_id  text references evidence (id),
  created_at   timestamptz not null default now()
);

-- one directed edge of a given relation between two nodes, at most once, so a
-- re-distill or a re-answer that recomputes the same link never duplicates it.
-- insertEdge uses ON CONFLICT DO NOTHING against this, mirroring provenance_unique.
create unique index if not exists edge_unique on edge (from_id, to_id, relation);
create index if not exists edge_from_idx on edge (from_id);
create index if not exists edge_to_idx on edge (to_id);
