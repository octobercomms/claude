-- Reply polling has always been silent. pollReplies() returns
-- { skipped: 'IMAP not configured' } and nobody ever sees it, so an operator
-- whose inbox was never connected has no way to learn that unsubscribe replies
-- are not being picked up — they just do it by hand and assume that is the job.
--
-- One row, rewritten on every poll, so the UI can say whether it is running,
-- when it last ran, and whether it actually matched anything.
CREATE TABLE IF NOT EXISTS outreach_reply_poll_state (
  id             BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  last_run_at    TIMESTAMPTZ,
  last_ok_at     TIMESTAMPTZ,      -- last run that connected to the inbox
  last_match_at  TIMESTAMPTZ,      -- last run that matched a reply to a contact
  skipped_reason TEXT,             -- set when the poll could not run at all
  last_error     TEXT,
  scanned        INT NOT NULL DEFAULT 0,
  matched        INT NOT NULL DEFAULT 0,
  unsubscribed   INT NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO outreach_reply_poll_state (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;
