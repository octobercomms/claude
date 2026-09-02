-- Press outreach refinements:
--  * Persist the selected audience on the release so closing/reopening a
--    campaign restores it (tags chosen + individually-added journalists).
--  * A per-client press signature/footer the AM can configure once and have
--    appended to every pitch + follow-up (so emails read as personal mail).

ALTER TABLE outreach_press_releases
  ADD COLUMN IF NOT EXISTS selected_tags TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS extra_contacts JSONB DEFAULT '[]'::jsonb;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS press_signature TEXT;
