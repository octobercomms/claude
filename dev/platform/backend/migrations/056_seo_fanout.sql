-- Query Fan-Out Simulator. Google's own docs (Optimizing your website for
-- generative AI features on Google Search, Nov 2025) call out that AI
-- Overviews work via "query fan-out" — the model generates a set of
-- concurrent related queries and pulls from the top results for all of
-- them, not just the literal user query. Whoever has coverage across the
-- fan-out gets cited.
--
-- This pair of tables records simulations: Claude generates the likely
-- fan-out for a seed query, we run DFS SERP for each, and store the
-- client's position vs. the top three URLs so the AM can see which
-- sub-intents to write content for.

CREATE TABLE IF NOT EXISTS seo_fanout_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  seed_query TEXT NOT NULL,
  location_code INT NOT NULL DEFAULT 2826,
  fanout_count INT NOT NULL DEFAULT 0,
  ranked_count INT NOT NULL DEFAULT 0,          -- queries where client ranks in top 10
  coverage_score NUMERIC(5, 2),                 -- ranked_count / fanout_count, 0–100
  summary_md TEXT,                              -- Claude's plain-English brief
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seo_fanout_runs_client
  ON seo_fanout_runs(client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS seo_fanout_queries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES seo_fanout_runs(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  intent_label VARCHAR(32),                     -- comparison / how-to / definition / etc
  rationale TEXT,                               -- why Claude included this query
  client_position INT,                          -- null = not in top 100
  client_url TEXT,
  top_urls JSONB NOT NULL DEFAULT '[]',         -- first 3 organic URLs as [{position, url}]
  ai_overview_present BOOLEAN NOT NULL DEFAULT FALSE,
  brand_cited BOOLEAN NOT NULL DEFAULT FALSE,
  position_order INT NOT NULL DEFAULT 0,        -- preserves Claude's ordering
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seo_fanout_queries_run
  ON seo_fanout_queries(run_id, position_order);
