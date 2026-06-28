-- Provenance is append-only links to evidence, but the SAME (node, evidence,
-- span) link should exist at most once. Without this, a worker retry that
-- re-runs entity merge, or two questions promoting the same node, silently
-- appends duplicate provenance rows and trace_to_source shows the same span
-- twice. The unique index makes provenance inserts idempotent: insertProvenance
-- uses ON CONFLICT DO NOTHING against it. This is additive and never touches the
-- evidence table.
create unique index if not exists provenance_unique
  on provenance (node_id, node_kind, evidence_id, span_start, span_end);
