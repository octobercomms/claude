-- Make press releases a campaign type rather than a parallel tab.
-- Existing campaigns default to 'cold'; press releases are tagged
-- 'press_release' at creation time so the Campaigns tab can show one
-- unified list with a small type badge.

ALTER TABLE outreach_campaigns
  ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'cold';

CREATE INDEX IF NOT EXISTS idx_outreach_campaigns_kind
  ON outreach_campaigns(client_id, kind);

-- Backfill any existing press-release-linked campaigns from phase 14.
UPDATE outreach_campaigns SET kind = 'press_release'
 WHERE id IN (SELECT campaign_id FROM outreach_press_releases WHERE campaign_id IS NOT NULL);
