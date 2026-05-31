-- Internal Strategist reports — Manus-style ad performance analyses
-- written for the AM, not the client. Each row is one generated report
-- covering a date range. data_snapshot stores the raw numbers fed into
-- Claude so the next report can compute deltas without re-fetching.

CREATE TABLE IF NOT EXISTS strategist_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'completed',   -- generating | completed | failed
  trigger VARCHAR(20) NOT NULL DEFAULT 'manual',     -- manual | weekly
  data_snapshot JSONB,
  markdown TEXT,
  error_message TEXT,
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_strategist_reports_client
  ON strategist_reports(client_id, generated_at DESC);
