-- Strategist briefing follow-through: split each report's recommendations
-- into their own rows so the AM can tick them off as done, and the next
-- week's briefing can ground recommendations in what was actually
-- actioned vs ignored.
--
-- Also adds a per-client recipients list for the Monday-morning email
-- that goes out with the new briefing. Comma- or newline-separated;
-- falls back to STRATEGIST_RECIPIENTS env var in the scheduler when null.

CREATE TABLE IF NOT EXISTS strategist_recommendations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID NOT NULL REFERENCES strategist_reports(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  position INT NOT NULL,
  text TEXT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT false,
  done_at TIMESTAMPTZ,
  done_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategist_recommendations_report
  ON strategist_recommendations(report_id, position);
CREATE INDEX IF NOT EXISTS idx_strategist_recommendations_client_open
  ON strategist_recommendations(client_id, done) WHERE done = false;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS strategist_recipients TEXT;
