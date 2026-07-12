-- 0017: the 'duplicates' edge relation. The write-time near-duplicate guard
-- links a suspected restatement to its canonical node with an advisory edge
-- (plus one deduped question for the human); the edge never changes a status
-- and never merges anything by itself. The relation check is a closed set, so
-- adding a value means recreating the constraint (the 0003 pattern).

alter table edge drop constraint if exists edge_relation_check;
alter table edge add constraint edge_relation_check
  check (relation in
    ('concerns', 'serves', 'supersedes', 'refines', 'conflicts_with', 'relates_to', 'duplicates'));
