-- 0016: the human-only retract status. A standalone false fact could not be
-- corrected: answer() only promotes or supersedes inside two-sided conflicts,
-- and dismiss is drift-catch-only. 'retracted' is the human saying "this
-- should never have been stored": the node keeps its content and provenance
-- (nothing is erased), it simply stops surfacing in retrieval. Set only by
-- the CLI/web retract path; there is deliberately no MCP tool for it, so the
-- promote gate gains its mirror: the agent proposes, the human promotes, and
-- only the human retracts.

alter table entity drop constraint if exists entity_status_check;
alter table entity add constraint entity_status_check
  check (status in ('open', 'decided', 'contested', 'superseded', 'retracted'));

alter table decision drop constraint if exists decision_status_check;
alter table decision add constraint decision_status_check
  check (status in ('open', 'decided', 'contested', 'superseded', 'retracted'));

alter table goal drop constraint if exists goal_status_check;
alter table goal add constraint goal_status_check
  check (status in ('open', 'decided', 'contested', 'superseded', 'retracted'));

alter table question drop constraint if exists question_status_check;
alter table question add constraint question_status_check
  check (status in ('open', 'decided', 'contested', 'superseded', 'dismissed', 'retracted'));
