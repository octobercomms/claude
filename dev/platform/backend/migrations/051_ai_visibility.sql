-- AI Visibility tracker — the Nimt-substitute. Tracks where each client's
-- brand shows up when real users ask ChatGPT / Claude / Gemini /
-- Perplexity / Google AI Overviews questions in their category. Same
-- discipline ("AEO — answer engine optimization") that's becoming the
-- 2026 version of SEO.
--
-- ai_visibility_prompts — the curated set of prompts per client.
-- Generated initially by Claude from the brand briefing, hand-edited
-- by the AM, run weekly across every configured engine.
--
-- ai_visibility_runs — one row per (prompt, engine, run). Stores the
-- raw response so we can re-analyse for new mentions later if a
-- competitor name changes; brand_mentioned + brand_position + the
-- competitor_mentions[] array are the structured signal the
-- summary endpoint queries.

CREATE TABLE IF NOT EXISTS ai_visibility_prompts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  category VARCHAR(40),                  -- 'category' | 'comparison' | 'how_to' | 'recommendation'
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aivp_client ON ai_visibility_prompts(client_id, active);

CREATE TABLE IF NOT EXISTS ai_visibility_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  prompt_id UUID REFERENCES ai_visibility_prompts(id) ON DELETE SET NULL,
  prompt_text TEXT NOT NULL,
  engine VARCHAR(30) NOT NULL,           -- 'claude' | 'gpt' | 'gemini' | 'perplexity' | 'google_aio'
  response_text TEXT NOT NULL,
  brand_mentioned BOOLEAN NOT NULL DEFAULT false,
  brand_position INT,                    -- 1 = first mention in response, null = not mentioned
  competitor_mentions TEXT[] NOT NULL DEFAULT '{}',
  sentiment VARCHAR(20),                 -- 'positive' | 'neutral' | 'negative' | null
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,   -- engines that cite sources (Perplexity, AIO)
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aivr_client_fetched ON ai_visibility_runs(client_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_aivr_engine ON ai_visibility_runs(client_id, engine, fetched_at DESC);
