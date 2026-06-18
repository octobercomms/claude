-- AI-SEO: competitor-derived keyword targets + article fit scans.
--
-- keyword_targets: the ranked list of keywords/topics the client's competitors
-- win on in AI search and traditional SERPs — the "give me the top 50 keywords"
-- step. article_scans: each of the client's articles scored against those
-- targets with concrete on-page fixes — the "rate and optimise every article"
-- step. See services/aiSeo.js.

CREATE TABLE IF NOT EXISTS ai_seo_keyword_targets (
  id          SERIAL PRIMARY KEY,
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  keyword     TEXT NOT NULL,
  intent      TEXT,                              -- informational | commercial | transactional | navigational
  rationale   TEXT,                              -- why it's worth targeting
  priority    INTEGER NOT NULL DEFAULT 3,        -- 1 (highest) .. 5
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_seo_keywords_client ON ai_seo_keyword_targets (client_id, priority);

CREATE TABLE IF NOT EXISTS ai_seo_article_scans (
  id           SERIAL PRIMARY KEY,
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  title        TEXT,
  best_keyword TEXT,                             -- the target this article fits best
  score        INTEGER,                          -- 0..100 optimisation score
  summary      TEXT,
  fixes        JSONB NOT NULL DEFAULT '[]'::jsonb, -- concrete on-page actions
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_seo_scans_client ON ai_seo_article_scans (client_id, created_at DESC);
