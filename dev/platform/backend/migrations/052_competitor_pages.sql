-- Competitor landing-page snapshots — the Opinly-substitute. Sits
-- alongside Phase 13's competitor_posts (which scrapes social) and
-- watches each competitor's website for material changes: hero copy,
-- pricing, headline value propositions.
--
-- competitor_pages — the AM-curated URLs to watch per client. Each
-- has a label so the change feed reads "Nike's pricing page changed"
-- rather than "https://nike.com/pricing changed".
--
-- competitor_page_snapshots — one row per fetch. We keep the full
-- extracted text so the diff can be re-run with a smarter algorithm
-- later, plus a hash for quick dedupe and a changed_blocks JSON
-- summary of what's different from the previous snapshot.

CREATE TABLE IF NOT EXISTS competitor_pages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  label VARCHAR(80),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT competitor_pages_url_unique UNIQUE (client_id, url)
);

CREATE TABLE IF NOT EXISTS competitor_page_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  page_id UUID NOT NULL REFERENCES competitor_pages(id) ON DELETE CASCADE,
  content_text TEXT NOT NULL,
  content_hash CHAR(64) NOT NULL,
  changed_blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cps_page_fetched
  ON competitor_page_snapshots(page_id, fetched_at DESC);
