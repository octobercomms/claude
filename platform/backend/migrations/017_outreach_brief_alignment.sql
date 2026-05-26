-- Outreach: align schema with the product brief.
--
-- Adds per-campaign sending identity (from_name / from_email / reply_to),
-- campaign type and brand, coupon code, press release URL, and a JSONB
-- column to cache Claude's refined audience between wizard steps.
--
-- Contacts gain a first/last name split, contact type, title (separate
-- from the existing free-text role), location, LinkedIn URL, and a
-- source tag (hunter / icypeas / manual / csv). The original `name` and
-- `role` columns stay so existing rows keep displaying — new code should
-- prefer the split fields and fall back to the legacy ones.

ALTER TABLE outreach_campaigns
  ADD COLUMN IF NOT EXISTS brand VARCHAR(255),
  ADD COLUMN IF NOT EXISTS campaign_type VARCHAR(40) NOT NULL DEFAULT 'outreach',
  ADD COLUMN IF NOT EXISTS from_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS from_email VARCHAR(320),
  ADD COLUMN IF NOT EXISTS reply_to VARCHAR(320),
  ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(100),
  ADD COLUMN IF NOT EXISTS press_release_url TEXT,
  ADD COLUMN IF NOT EXISTS refined_audience JSONB,
  ADD COLUMN IF NOT EXISTS searched_domains JSONB DEFAULT '[]'::jsonb;

ALTER TABLE outreach_contacts
  ADD COLUMN IF NOT EXISTS first_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS last_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS contact_type VARCHAR(60),
  ADD COLUMN IF NOT EXISTS title VARCHAR(255),
  ADD COLUMN IF NOT EXISTS location VARCHAR(255),
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
  ADD COLUMN IF NOT EXISTS source VARCHAR(60);

-- Backfill first/last from the existing combined `name` so the new
-- wizard fields render sensibly for rows added before this migration.
UPDATE outreach_contacts
SET
  first_name = COALESCE(first_name, split_part(name, ' ', 1)),
  last_name = COALESCE(last_name, NULLIF(trim(substring(name from position(' ' in name) + 1)), ''))
WHERE name IS NOT NULL
  AND (first_name IS NULL OR last_name IS NULL);

CREATE INDEX IF NOT EXISTS idx_outreach_contacts_type ON outreach_contacts(client_id, contact_type);
CREATE INDEX IF NOT EXISTS idx_outreach_contacts_location ON outreach_contacts(client_id, location);
CREATE INDEX IF NOT EXISTS idx_outreach_campaigns_status ON outreach_campaigns(client_id, status);
