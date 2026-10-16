-- Catching up on replies that arrived while nobody was reading the mailbox.
--
-- pollReplies() looks back three days, which is right for stopping a follow-up
-- before it goes out and useless for a backlog. October sent press releases
-- replying to press@ while the poll read hello@, so months of replies to press@
-- were never matched and, worse, never checked for opt-outs. Adding press@ to
-- the mailbox list fixes everything from now on and nothing from before.
--
-- This is the backlog pass. It is deliberately two steps: a scan that writes
-- nothing to a send or a contact, and an apply that a person presses. Both
-- actions it proposes only ever STOP mail going out (mark a send replied,
-- cancel its follow-ups, record an opt-out), so the worst case of applying one
-- wrongly is a follow-up you would have liked to send. That asymmetry is why
-- there is no undo here: reversing an opt-out would resume mail to someone who
-- asked you to stop, which must never be one button press.

CREATE TABLE IF NOT EXISTS outreach_reply_catchup (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Stable per message, so re-scanning a window never proposes the same reply
  -- twice and a widened window is cheap. Same derivation as the out-of-office
  -- watermark: Message-Id where the sender set one, else a hash.
  message_key   TEXT NOT NULL UNIQUE,

  inbox_label   TEXT,                      -- which mailbox it was found in
  from_email    TEXT NOT NULL,
  subject       TEXT,
  received_at   TIMESTAMPTZ,               -- the reply's own date, not scan time
  snippet       TEXT,                      -- first part of what they actually wrote

  contact_id    UUID REFERENCES outreach_contacts(id) ON DELETE CASCADE,
  campaign_id   UUID REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
  client_id     UUID REFERENCES clients(id) ON DELETE CASCADE,

  -- The sends this reply would mark. Held as an array because one journalist
  -- can have several open sends across steps of the same campaign.
  send_ids      UUID[] NOT NULL DEFAULT '{}',

  -- What applying would do. Both are "stop sending" actions.
  mark_replied  BOOLEAN NOT NULL DEFAULT FALSE,
  unsubscribe   BOOLEAN NOT NULL DEFAULT FALSE,

  -- The phrase that triggered the opt-out reading, so the reviewer can see WHY
  -- rather than trust a boolean. An opt-out applied on a bad match is the one
  -- mistake here that costs coverage.
  unsub_phrase  TEXT,

  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | applied | dismissed
  applied_at    TIMESTAMPTZ,
  applied_by    TEXT,
  applied_note  TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The queue is worked pending-first, opt-outs before plain replies (they are
-- the compliance half), then newest first.
CREATE INDEX IF NOT EXISTS idx_reply_catchup_queue
  ON outreach_reply_catchup (status, unsubscribe DESC, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_reply_catchup_contact
  ON outreach_reply_catchup (contact_id);
