-- 0014: freshness. Two nullable, additive timestamps on every distilled node.
-- verified_at is set only when a human promotes a fact (the human answer is the
-- verification event), so "verified" means a human stood behind it, and when.
-- expires_at is optional: a brain-level TTL (MARROW_FACT_TTL_DAYS) can set it at
-- promote time; default null means a fact does not expire. Confidence is NEVER
-- decayed in place. These columns let staleness be shown, not enforced. Additive
-- and nullable, so there is no backfill and every existing row reads back with
-- null freshness.
alter table entity add column if not exists verified_at timestamptz;
alter table entity add column if not exists expires_at timestamptz;
alter table decision add column if not exists verified_at timestamptz;
alter table decision add column if not exists expires_at timestamptz;
alter table question add column if not exists verified_at timestamptz;
alter table question add column if not exists expires_at timestamptz;
alter table goal add column if not exists verified_at timestamptz;
alter table goal add column if not exists expires_at timestamptz;
