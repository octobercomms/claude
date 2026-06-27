-- Saved searches for IG discovery. A client can keep several named searches
-- (e.g. "Residential architects · Atlanta", "Commercial architects"), each with
-- its own daily autopilot. The overnight scheduler re-runs every enabled search
-- and emails a digest of new finds. Discovery only; the AM sends DMs by hand.
CREATE TABLE IF NOT EXISTS ig_outreach_searches (
  id          SERIAL PRIMARY KEY,
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  icp         TEXT,
  location    TEXT,
  hashtags    TEXT,                 -- comma-separated
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,   -- daily autopilot on/off
  last_run_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ig_searches_client ON ig_outreach_searches (client_id);

-- Tie each discovered prospect to the search that found it, and hold an email
-- once enriched (for CSV export into an email tool).
ALTER TABLE ig_outreach_prospects ADD COLUMN IF NOT EXISTS search_id INTEGER REFERENCES ig_outreach_searches(id) ON DELETE SET NULL;
ALTER TABLE ig_outreach_prospects ADD COLUMN IF NOT EXISTS email TEXT;
