-- SEO suite expansion:
--   - seo_keywords.intent          → Informational / Navigational / Commercial / Transactional
--                                     (classified by Claude in a batch call)
--   - seo_rank_history.serp_features → JSONB array of features observed at check time
--                                     (featured_snippet, image_pack, knowledge_panel, etc.)
--                                     captured for free during the existing DataForSEO rank call
--   - aio_history                  → per-keyword AI Overview presence + brand citation history
--   - clients.competitor_domains   → array of competitor domains used for content-gap analysis

ALTER TABLE seo_keywords
  ADD COLUMN IF NOT EXISTS intent VARCHAR(20);

ALTER TABLE seo_rank_history
  ADD COLUMN IF NOT EXISTS serp_features JSONB;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS competitor_domains TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS aio_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  keyword_id UUID NOT NULL REFERENCES seo_keywords(id) ON DELETE CASCADE,
  checked_at DATE NOT NULL DEFAULT CURRENT_DATE,
  present BOOLEAN NOT NULL DEFAULT false,
  brand_cited BOOLEAN NOT NULL DEFAULT false,
  snippet TEXT,
  UNIQUE(keyword_id, checked_at)
);

CREATE INDEX IF NOT EXISTS idx_aio_history_keyword_id ON aio_history(keyword_id);
CREATE INDEX IF NOT EXISTS idx_aio_history_checked_at ON aio_history(checked_at DESC);
