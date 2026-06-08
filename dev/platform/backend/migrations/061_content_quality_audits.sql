-- Content quality audit — Claude-graded per-page deep dive.
--
-- Differs from site_audit_issues which catches heuristic on-page tech
-- issues (broken meta, missing H1, etc) across a 30-page crawl. Content
-- audit goes deep on ONE page: actual content quality, keyword usage,
-- readability, missing sub-topics, an opinionated rewrite recommendation.
-- Costs a Claude call per audit; we don't bulk-run automatically.

CREATE TABLE IF NOT EXISTS content_audits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  target_keyword TEXT,                            -- AM-supplied; helps the keyword-usage assessment
  status VARCHAR(20) NOT NULL DEFAULT 'running',  -- running | complete | failed
  -- Page snapshot at audit time
  title TEXT,
  meta_description TEXT,
  word_count INT,
  -- Claude's structured findings
  thin_content_score INT,                         -- 1–5; 5 = excellent depth
  readability_grade VARCHAR(2),                   -- A–F
  detected_primary_keyword TEXT,
  keyword_usage VARCHAR(20),                      -- good | under | over | absent
  missing_subtopics_json JSONB,                   -- ["topic 1", "topic 2", ...]
  suggested_additions_json JSONB,                 -- [{ heading, rationale }]
  overall_recommendation TEXT,                    -- markdown narrative
  priority VARCHAR(10),                           -- low | medium | high
  -- Bookkeeping
  claude_model VARCHAR(64),
  tokens_used INT,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_content_audits_client
  ON content_audits(client_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_audits_priority
  ON content_audits(client_id, priority)
  WHERE status = 'complete';
