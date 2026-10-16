-- Reading more than one mailbox.
--
-- Until now the reply poll read a single inbox, set by the OUTREACH_IMAP_*
-- platform settings. October sends press releases with a reply-to of press@
-- and polls hello@, so every reply to press@ was invisible. That is not only a
-- 0% reply figure on the dashboard: looksLikeUnsubscribe() runs inside the same
-- poll, so a journalist who replied "remove me" to press@ was never suppressed
-- and kept receiving follow-ups. The reporting gap is cosmetic; that one is not.
--
-- Each row is one mailbox OMI reads, carrying both its credentials and the
-- state of its last poll. Folding state into the same row (rather than keeping
-- the single-row outreach_reply_poll_state) means "when did press@ last work?"
-- is answerable per mailbox, which is the question an operator actually asks.

CREATE TABLE IF NOT EXISTS outreach_inboxes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  label         TEXT NOT NULL,                 -- what the operator calls it: "press@", "hello@"
  host          TEXT NOT NULL,
  port          INTEGER NOT NULL DEFAULT 993,
  username      TEXT NOT NULL,
  -- Same shape as outreach_mailboxes.smtp_password_enc: utils/encryption
  -- encrypt() output, never the plaintext. Read back only to open the socket.
  password_enc  JSONB NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT TRUE,

  -- The two jobs a mailbox feeds, independently switchable. Replies drive
  -- reply/unsubscribe matching; OOO drives the contact-update queue.
  poll_replies  BOOLEAN NOT NULL DEFAULT TRUE,
  scan_ooo      BOOLEAN NOT NULL DEFAULT TRUE,

  -- Noise control for the out-of-office feed, and the reason multi-inbox needs
  -- it: one outreach inbox yields a workable queue, but a personal or finance
  -- account is mostly auto-replies from people who will never be contacts.
  -- With this on, such a mailbox only raises a suggestion when the sender is
  -- already in OMI, so it can still catch "my colleague has taken over" for
  -- someone you track without burying the queue in supplier mail.
  known_senders_only BOOLEAN NOT NULL DEFAULT FALSE,

  -- Per-mailbox poll state, so a failure names the mailbox it belongs to.
  last_run_at   TIMESTAMPTZ,
  last_ok_at    TIMESTAMPTZ,                   -- last run that connected
  last_match_at TIMESTAMPTZ,                   -- last run that matched a reply
  last_error    TEXT,
  scanned       INT NOT NULL DEFAULT 0,
  matched       INT NOT NULL DEFAULT 0,
  unsubscribed  INT NOT NULL DEFAULT 0,
  ooo_queued    INT NOT NULL DEFAULT 0,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per mailbox. Adding the same account twice would double every reply
-- it carries and poll it twice a cycle.
CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_inboxes_user
  ON outreach_inboxes (lower(username), lower(host));

CREATE INDEX IF NOT EXISTS idx_outreach_inboxes_active
  ON outreach_inboxes (active) WHERE active;
