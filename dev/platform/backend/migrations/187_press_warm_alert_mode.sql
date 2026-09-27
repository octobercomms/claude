-- Stop the warm-journalist email flood, and fix what caused it.
--
-- What happened: the interest watcher flags a journalist "warm" at 3 opens or
-- any click, and emails the AM once per (campaign, journalist). On a
-- 10,656-recipient release that produced hundreds of emails in a few days.
--
-- Why it is mostly noise: `open_count` increments on every fetch of the
-- tracking pixel, and Apple Mail Privacy Protection and Gmail's image proxy
-- pre-fetch images without a human reading anything, repeatedly, over days. A
-- threshold of 3 opens is therefore crossed by machines. The alerts were real
-- in the sense that the counter moved; they were not evidence of interest.
--
-- Two changes:
--
--   1. alerted_at lets a digest send one email covering many warm journalists
--      instead of one email each. The row is still written the moment someone
--      goes warm (so the dashboard is live); only the notification is batched.
--
--   2. The scoring default moves to clicks-only. A click is a deliberate human
--      action that image proxies do not perform. Not perfect — corporate link
--      scanners do fetch URLs — but far cleaner than an MPP-inflated open.
--      Opens stay available via press_warm_config.min_opens for anyone who
--      wants them; they are simply no longer on by default.
--
-- Existing rows are backfilled as already alerted, so turning the digest on
-- does not immediately mail out the entire backlog that caused the complaint.

ALTER TABLE press_interest_alerts
  ADD COLUMN IF NOT EXISTS alerted_at TIMESTAMPTZ;

COMMENT ON COLUMN press_interest_alerts.alerted_at IS
  'When the AM was notified. NULL = warm but not yet notified (picked up by the daily digest).';

UPDATE press_interest_alerts SET alerted_at = created_at WHERE alerted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_press_interest_alerts_pending
  ON press_interest_alerts (created_at) WHERE alerted_at IS NULL;
