-- RSS pipeline, phase 1 — give every publication a home URL and an RSS/Atom
-- feed, and a place to store the articles we ingest from it (used in phase 2+).

ALTER TABLE pr_outlets
  ADD COLUMN IF NOT EXISTS url            TEXT,
  ADD COLUMN IF NOT EXISTS rss_url        TEXT,
  ADD COLUMN IF NOT EXISTS rss_status     VARCHAR(16) NOT NULL DEFAULT 'unknown', -- unknown | found | none | error
  ADD COLUMN IF NOT EXISTS rss_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS feed_fetched_at TIMESTAMPTZ;

-- Ingested feed items. One row per (outlet, article); contact_id is filled in
-- when we can match the byline to a journalist already in the DB.
CREATE TABLE IF NOT EXISTS pr_outlet_articles (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outlet_id    UUID NOT NULL REFERENCES pr_outlets(id) ON DELETE CASCADE,
  contact_id   UUID REFERENCES outreach_contacts(id) ON DELETE SET NULL,
  title        TEXT,
  url          TEXT,
  author_name  TEXT,          -- raw byline as it appears in the feed
  guid         TEXT,          -- feed-supplied unique id, when present
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dedupe: one row per (outlet, guid-or-url).
CREATE UNIQUE INDEX IF NOT EXISTS idx_outlet_articles_uniq
  ON pr_outlet_articles (outlet_id, COALESCE(guid, url));
CREATE INDEX IF NOT EXISTS idx_outlet_articles_contact
  ON pr_outlet_articles (contact_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_outlet_articles_outlet
  ON pr_outlet_articles (outlet_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_pr_outlets_rss_status
  ON pr_outlets (rss_status);
