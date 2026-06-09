-- Link an authored/approved press release to the distribution campaign it
-- spawned, so the PR editor can toggle "Create pitch campaign" → "Open pitch
-- campaign" and we never create a second campaign for the same release.

ALTER TABLE pr_press_releases
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES outreach_campaigns(id) ON DELETE SET NULL;
