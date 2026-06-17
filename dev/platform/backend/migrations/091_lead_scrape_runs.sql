-- Lead-scraper run history — backs the async ICP scrape (slice 3): describe an
-- audience, Serper finds candidate sites, the scraper crawls each and the
-- contacts accumulate into one run the UI polls. See docs/omi/lead-scraper-plan.md.

CREATE TABLE IF NOT EXISTS lead_scrape_runs (
  id          SERIAL PRIMARY KEY,
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL DEFAULT 'icp',     -- icp (future: site, url)
  input       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status      TEXT NOT NULL DEFAULT 'running', -- running | done | failed
  sites_total INTEGER NOT NULL DEFAULT 0,
  sites_done  INTEGER NOT NULL DEFAULT 0,
  found_count INTEGER NOT NULL DEFAULT 0,
  results     JSONB NOT NULL DEFAULT '[]'::jsonb,  -- the accumulated contacts
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_scrape_runs_client ON lead_scrape_runs (client_id, created_at DESC);
