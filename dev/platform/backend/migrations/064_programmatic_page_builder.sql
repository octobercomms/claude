-- Programmatic page builder — CSV-driven bulk brief generation.
--
-- One programmatic_run per "I want to generate 50 service-area pages
-- from this spreadsheet" operation. Each row in the CSV becomes a
-- programmatic_brief; each brief carries the row data (so the AM can
-- see which row produced what), the template that fed Claude, and the
-- generated brief JSON in the same shape as the cluster brief output.
--
-- AMs can then promote any individual brief into Pipeline → Draft
-- (creating a content_draft) without re-running the brief generation.

CREATE TABLE IF NOT EXISTS programmatic_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                              -- AM-supplied label, e.g. "UK service-area pages Q3"
  template_prompt TEXT NOT NULL,                   -- the AM's template — placeholders like {service} {location}
  csv_headers JSONB NOT NULL,                      -- ["service", "location", "price"]
  total_rows INT NOT NULL DEFAULT 0,
  completed_rows INT NOT NULL DEFAULT 0,
  failed_rows INT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'running',   -- running | complete | failed | cancelled
  estimated_cost_usd NUMERIC(8, 4),                -- pre-run estimate so the AM sees the bill
  claude_model VARCHAR(64),
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_programmatic_runs_client
  ON programmatic_runs(client_id, started_at DESC);

CREATE TABLE IF NOT EXISTS programmatic_briefs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES programmatic_runs(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  row_index INT NOT NULL,                          -- 0-based, matches the CSV row
  row_data JSONB NOT NULL,                         -- the raw row as {header: value}
  -- Generated brief
  title TEXT,
  slug TEXT,                                       -- suggested URL slug (placeholder-substituted)
  primary_keyword TEXT,
  brief_json JSONB,                                -- same shape as the cluster brief output
  status VARCHAR(20) NOT NULL DEFAULT 'pending',   -- pending | generating | complete | failed
  error_message TEXT,
  content_draft_id UUID REFERENCES content_drafts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_programmatic_briefs_run
  ON programmatic_briefs(run_id, row_index);

CREATE INDEX IF NOT EXISTS idx_programmatic_briefs_client_status
  ON programmatic_briefs(client_id, status);
