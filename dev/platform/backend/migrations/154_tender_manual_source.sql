-- A source row for tenders added by hand (paste-a-URL). enabled=false so the
-- daily ingest never "polls" it — it only exists to own manually added notices
-- (tender_notices.source_id is NOT NULL). Notices added via POST
-- /tender/notices/add-url are attached here.
INSERT INTO tender_sources (name, kind, market, endpoint, config, enabled) VALUES
  ('Added by URL', 'manual', 'global', 'manual', '{}'::jsonb, false)
ON CONFLICT (name) DO NOTHING;
