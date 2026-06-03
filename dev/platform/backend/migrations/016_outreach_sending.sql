-- Outreach pass 5: sending engine.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS outreach_sending JSONB;
ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS launched_at TIMESTAMPTZ;
