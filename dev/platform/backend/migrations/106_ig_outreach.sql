-- Instagram discovery → manual-outreach queue. A discovery engine finds public
-- IG profiles matching a client's ICP (via web search / official APIs — never
-- by scraping a logged-in account); the AM does the actual DMing by hand from
-- the queue (Open-DM deep link + copy a personalised draft). Status tracks the
-- conversation: new → queued → messaged → replied (or skipped).
CREATE TABLE IF NOT EXISTS ig_outreach_prospects (
  id           SERIAL PRIMARY KEY,
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  username     TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'serper',   -- serper | hashtag | apollo
  display_name TEXT,
  bio          TEXT,
  profile_url  TEXT,
  status       TEXT NOT NULL DEFAULT 'new',       -- new | queued | messaged | replied | skipped
  draft        TEXT,
  notes        TEXT,
  found_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  messaged_at  TIMESTAMPTZ,
  replied_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ig_prospect_client_user ON ig_outreach_prospects (client_id, lower(username));
CREATE INDEX IF NOT EXISTS idx_ig_prospect_client_status ON ig_outreach_prospects (client_id, status, found_at DESC);
