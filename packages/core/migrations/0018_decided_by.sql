-- 0018: named humans. Every promote-to-decided is a human act; this records
-- WHICH human, so a team can tell whose judgment a fact carries. Additive and
-- nullable: existing decided facts read back with a null decider (promoted
-- before this column existed), and nothing is backfilled. decided_by is
-- metadata about the promote event, never about what may be decided: it is
-- written only at the moment of promotion, alongside confidence_source =
-- 'human', and never changes what path can reach decided.
alter table entity add column if not exists decided_by text;
alter table decision add column if not exists decided_by text;
alter table question add column if not exists decided_by text;
alter table goal add column if not exists decided_by text;
