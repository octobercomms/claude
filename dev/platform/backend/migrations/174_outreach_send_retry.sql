-- Durable retry for the outreach/press send queue. Before this, a send row that
-- threw once was marked 'failed' and never re-attempted, and a row claimed
-- ('sending') by a worker that then crashed was stranded forever — the two ways
-- a large send could quietly leave people unsent.
--
--   attempts    how many times we've claimed+tried this row (incremented at claim)
--   claimed_at  when the row was last claimed for sending; the reaper uses this
--               to return a stalled 'sending' row to the queue
--   last_error  the most recent failure reason, surfaced in the delivery panel
--
-- See services/scheduler.js (runOutreachSends: reaper + backoff retry) and the
-- campaign-level /retry-failed endpoint.
ALTER TABLE outreach_sends
  ADD COLUMN IF NOT EXISTS attempts   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

-- The reaper and the retry endpoint both scan by status; a partial index keeps
-- those scans cheap even with a large send history sitting in 'sent'.
CREATE INDEX IF NOT EXISTS idx_outreach_sends_active_status
  ON outreach_sends (status)
  WHERE status IN ('pending', 'sending', 'failed');
