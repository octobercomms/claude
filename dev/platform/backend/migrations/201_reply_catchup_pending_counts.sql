-- What applying a catch-up row will actually stop, counted at scan time.
--
-- The review screen tells you a reply was found. It has not been telling you
-- what the Apply button does, and the two actions behind it have different
-- scopes, which is not something anyone should have to infer:
--
--   * Marking a reply cancels pending sends to that contact ACROSS campaigns
--     and clients, the same scope as the live poll.
--   * Recording an opt-out cancels pending sends for that contact on the ONE
--     client whose campaign they replied to, and suppresses them there.
--
-- Writing "this stops your queued follow-ups" without a number would be
-- guessing, and writing it when nothing is queued would be wrong. So the scan
-- counts both and stores them, and the notice says only what the numbers
-- support.
--
-- These are a snapshot from the last scan, not a promise. applied_note still
-- reports what actually happened at the moment of applying.

ALTER TABLE outreach_reply_catchup
  ADD COLUMN IF NOT EXISTS pending_all    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_client INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN outreach_reply_catchup.pending_all IS
  'Sends still pending to this contact anywhere, at the last scan. What marking a reply cancels.';
COMMENT ON COLUMN outreach_reply_catchup.pending_client IS
  'Sends still pending to this contact on this row''s client, at the last scan. What an opt-out cancels.';

-- Rows raised before this migration carry 0/0, which reads as "nothing
-- queued" and would be a confident wrong answer on the very screen this is
-- meant to make honest. A re-scan refreshes every pending row in place
-- (replyCatchup.consider), so marking them NULL-equivalent is unnecessary:
-- instead, nothing is claimed for a row until a scan has counted it.
ALTER TABLE outreach_reply_catchup
  ADD COLUMN IF NOT EXISTS counts_known BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN outreach_reply_catchup.counts_known IS
  'False on rows raised before the counts existed. The notice omits send counts rather than claiming zero.';
