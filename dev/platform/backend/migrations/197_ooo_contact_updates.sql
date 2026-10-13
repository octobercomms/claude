-- Contact updates from out-of-office replies: three doors, one queue, and an undo.
--
-- Migration 180 built the queue for one door (MailFlow POSTing suggestions).
-- Two more now feed the same table: a CSV upload of a MailFlow export, and
-- OMI's own IMAP reply poll, which already reads the outreach inbox every cycle
-- and until now threw the out-of-office content away.
--
-- The columns here exist for one reason: an automatic feed reads ALL mail, not
-- just press mail, so a wrong apply is a question of when, not if. So we record
-- where each suggestion came from, whether we recognise the sender, why it was
-- flagged, and -- the important one -- the exact prior values of every field an
-- apply overwrites, so it can be put back.

ALTER TABLE ooo_suggestions
  -- Which door this arrived through. 'mailflow' is the original token-gated
  -- POST; 'csv' a hand-uploaded export; 'imap' OMI's own reply poll.
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'mailflow',

  -- Did the sender match a contact OMI already holds? This is the safety
  -- divide, not a nicety: October's inbox carries suppliers, accountants and
  -- personal mail, and an auto-reply from any of them extracts just as cleanly
  -- as one from an editor. False lands the row in a separate review list that
  -- is never pre-ticked and never batch-applied by default.
  ADD COLUMN IF NOT EXISTS sender_known BOOLEAN NOT NULL DEFAULT FALSE,

  -- The sender address, lifted out of source->>'from_email' so it can be
  -- indexed and grouped. Denormalised deliberately.
  ADD COLUMN IF NOT EXISTS source_sender TEXT,

  -- Why the importer held this back: [{code,detail}]. Empty means it passed
  -- every gate. Shown on the card so a flag can be overruled, not just obeyed.
  ADD COLUMN IF NOT EXISTS flags JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- The prior values of every field the apply wrote, captured in the same
  -- statement that wrote them: {contact_id, fields:{email,company,role},
  -- created_contact_ids:[...]}. undoSuggestion() replays it. Without this an
  -- apply is irreversible, which is the whole risk of automating the feed.
  ADD COLUMN IF NOT EXISTS before_state JSONB,

  -- Audit: which user pressed go, and who undid it.
  ADD COLUMN IF NOT EXISTS applied_by TEXT,
  ADD COLUMN IF NOT EXISTS undone_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS undone_by TEXT;

-- The id was MailFlow's UUID. CSV rows and IMAP messages have no UUID, so both
-- derive a deterministic one by hashing (sender, subject, date, emails) -- a
-- re-upload or a re-scan of the same reply updates its row instead of adding a
-- second. Widened to TEXT so a hash can live beside a real UUID.
ALTER TABLE ooo_suggestions ALTER COLUMN id TYPE TEXT;

-- The two review lists are read separately and constantly; status alone is too
-- coarse once the IMAP feed is running and unknown senders outnumber known ones.
CREATE INDEX IF NOT EXISTS idx_ooo_suggestions_bucket
  ON ooo_suggestions (status, sender_known, confidence DESC NULLS LAST, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_ooo_suggestions_sender
  ON ooo_suggestions (lower(source_sender));

-- Backfill the two columns derivable from rows already in the table.
UPDATE ooo_suggestions
   SET source_sender = COALESCE(source_sender, source->>'from_email'),
       sender_known  = COALESCE(sender_known, matched_contact_id IS NOT NULL)
 WHERE source_sender IS NULL OR sender_known IS FALSE;

-- Per-message watermark for the IMAP scanner, so a reply is extracted once and
-- a widened backfill window doesn't re-read the whole inbox every cycle. Keyed
-- on the message-id where present, else a hash of the envelope.
CREATE TABLE IF NOT EXISTS ooo_scanned_messages (
  message_key TEXT PRIMARY KEY,
  scanned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  was_auto_reply BOOLEAN NOT NULL DEFAULT FALSE,
  suggestion_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_ooo_scanned_at ON ooo_scanned_messages (scanned_at DESC);
