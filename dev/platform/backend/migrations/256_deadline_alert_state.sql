-- Remember what each deadline was last alerted about.
--
-- Migration 253's fix stopped the alert calling nine-month-old entries "due
-- within 14 days". It left a real one repeating: the gate only asked "is
-- anything due", with no memory, so one genuine deadline sitting in the
-- fourteen-day window produced an email every weekday for a fortnight. An
-- accurate drumbeat is still a drumbeat, and it gets ignored the same way.
--
-- Per deadline rather than one global fingerprint, so several deadlines in the
-- window are judged independently: one of them crossing into "due in 3 days"
-- is news whether or not the others moved.

ALTER TABLE acct_tax_deadlines
  ADD COLUMN IF NOT EXISTS last_alert_bucket TEXT,
  ADD COLUMN IF NOT EXISTS last_alerted_at   TIMESTAMPTZ;

-- The read sendAlerts does: everything open, with what it was last told about.
CREATE INDEX IF NOT EXISTS idx_acct_deadlines_alert_state
  ON acct_tax_deadlines (status, due_date)
  WHERE status NOT IN ('filed', 'paid');
