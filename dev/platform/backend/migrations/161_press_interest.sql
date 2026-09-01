-- Press Outreach 2.0 — Phase 4: analytics + the 24/7 interest watcher.
-- Repeat-open counting (today only a single opened_at is stored), and the
-- "warm" interest flag per (journalist × client) that the watcher raises and
-- surfaces on the client dashboard.

-- Count every open, not just the first, and remember the most recent — the
-- watcher reads these to decide interest.
ALTER TABLE outreach_sends ADD COLUMN IF NOT EXISTS open_count INT NOT NULL DEFAULT 0;
ALTER TABLE outreach_sends ADD COLUMN IF NOT EXISTS last_opened_at TIMESTAMPTZ;

-- Warm interest lives on the per-client membership: a journalist can be warm for
-- one client's story and cold for another's. The watcher sets these; the client
-- dashboard reads them.
ALTER TABLE outreach_contact_clients ADD COLUMN IF NOT EXISTS interest_score INT NOT NULL DEFAULT 0;
ALTER TABLE outreach_contact_clients ADD COLUMN IF NOT EXISTS warm_at TIMESTAMPTZ;
ALTER TABLE outreach_contact_clients ADD COLUMN IF NOT EXISTS warm_reason TEXT;
ALTER TABLE outreach_contact_clients ADD COLUMN IF NOT EXISTS warm_campaign_id UUID;

-- Per-client interest threshold (what counts as "warm"). NULL = use the default
-- blend (3+ opens OR any click OR two opens within an hour). Shape:
--   { "min_opens": 3, "any_click": true, "burst_opens": 2, "burst_minutes": 60 }
ALTER TABLE clients ADD COLUMN IF NOT EXISTS press_warm_config JSONB;

-- Which sends the watcher has already alerted on, so an AM isn't pinged twice for
-- the same journalist warming up.
CREATE TABLE IF NOT EXISTS press_interest_alerts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id    UUID REFERENCES clients(id) ON DELETE CASCADE,
  campaign_id  UUID,
  contact_id   UUID REFERENCES outreach_contacts(id) ON DELETE CASCADE,
  score        INT,
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_press_interest_alerts_client ON press_interest_alerts (client_id, created_at DESC);
