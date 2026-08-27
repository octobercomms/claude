-- Auto go/no-go qualification. Each notice gets a verdict so the working list
-- can default to the ones worth a look and tuck the rejects into a "No-go" view
-- (nothing is deleted). Scored by services/tender/score.js against October's
-- profile + niche during ingest.
ALTER TABLE tender_notices
  ADD COLUMN IF NOT EXISTS verdict        TEXT,          -- 'go' | 'review' | 'nogo' | NULL (not yet scored)
  ADD COLUMN IF NOT EXISTS verdict_reason TEXT,
  ADD COLUMN IF NOT EXISTS verdict_at     TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tender_notices_verdict ON tender_notices (verdict);
