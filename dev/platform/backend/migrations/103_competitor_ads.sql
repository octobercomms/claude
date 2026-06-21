-- Competitor Google Ads intelligence. Stores each pull of a competitor's live
-- ads (from the Google Ads Transparency Center via SerpApi) plus Claude's
-- analysis, per client. See services/competitorAds.js.

CREATE TABLE IF NOT EXISTS competitor_ad_runs (
  id          SERIAL PRIMARY KEY,
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  query       TEXT NOT NULL,                         -- advertiser name / domain searched
  region      TEXT,
  ads         JSONB NOT NULL DEFAULT '[]'::jsonb,    -- normalised ad creatives
  analysis    JSONB NOT NULL DEFAULT '{}'::jsonb,    -- {overview, longest_running, angles, counter_ideas}
  ad_count    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_competitor_ad_runs_client ON competitor_ad_runs (client_id, created_at DESC);
