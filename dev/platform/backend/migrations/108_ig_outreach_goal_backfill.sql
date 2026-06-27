-- (1) Per-search outreach goal — what the AM is DMing these people about — so
--     drafts are purposeful instead of generic.
ALTER TABLE ig_outreach_searches ADD COLUMN IF NOT EXISTS outreach_goal TEXT;

-- (2) Backfill: prospects discovered before saved searches existed have a NULL
--     search_id and so don't show in any queue. Adopt them into the client's
--     earliest search so they reappear where they belong.
UPDATE ig_outreach_prospects p
SET search_id = (
  SELECT s.id FROM ig_outreach_searches s
   WHERE s.client_id = p.client_id ORDER BY s.created_at, s.id LIMIT 1
)
WHERE p.search_id IS NULL
  AND EXISTS (SELECT 1 FROM ig_outreach_searches s2 WHERE s2.client_id = p.client_id);
