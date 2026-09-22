-- Out-of-office contact-change suggestions from MailFlow.
--
-- MailFlow scans auto-reply / OOO messages, extracts a lasting contact change
-- (new address, new employer, an alternate contact to use) and POSTs each as a
-- reviewable suggestion to OMI. OMI owns the review queue, the classification
-- (journalist / client / supplier / prospect / general), and the approve-and
-- -apply decision — nothing touches a contact record until a person approves.
--
-- `id` is MailFlow's own suggestion UUID and the idempotency key: a re-POST of
-- the same id updates the MailFlow-provided fields in place and never creates a
-- duplicate, and never resurrects a row a reviewer already applied/dismissed.
CREATE TABLE IF NOT EXISTS ooo_suggestions (
  id UUID PRIMARY KEY,                          -- MailFlow suggestion UUID (idempotency key)
  mailflow_user   TEXT,                         -- the "user" identifier from the batch envelope
  category        TEXT NOT NULL,                -- left_or_moved | mentions_alt_contact
  person          JSONB,                        -- {name,current_email,new_email,new_company,role}
  alt_contacts    JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{name,email,role,company}]
  source          JSONB,                        -- {from_email,subject,quote,message_date}
  confidence      REAL,                         -- MailFlow's 0..1 self-rating (a sort key, not a filter)
  detected_at     TIMESTAMPTZ,
  -- OMI-owned review state
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | applied | dismissed
  matched_contact_id UUID,                      -- outreach_contacts.id we matched on the sender (nullable)
  contact_class   TEXT,                         -- journalist|client|supplier|prospect|general|unknown
  applied_at      TIMESTAMPTZ,
  applied_note    TEXT,                          -- what applying did (audit line for the reviewer)
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The review queue is worked pending-first, then by confidence.
CREATE INDEX IF NOT EXISTS idx_ooo_suggestions_status
  ON ooo_suggestions (status, confidence DESC NULLS LAST, received_at DESC);
