-- Tender Agent: dismiss, per-notice Claude chat, and the email digest settings.

-- Dismiss: hide a notice permanently so it never shows again.
ALTER TABLE tender_notices ADD COLUMN IF NOT EXISTS dismissed    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tender_notices ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_tender_notices_dismissed ON tender_notices (dismissed);

-- Per-notice chat with Claude ("Start with Claude") — assess fit, outline a bid.
CREATE TABLE IF NOT EXISTS tender_chat_messages (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  notice_id  UUID NOT NULL REFERENCES tender_notices(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,                 -- user | assistant
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tender_chat_notice ON tender_chat_messages (notice_id, created_at);

-- Digest settings: whether to auto-email new matching tenders, and to whom.
-- Single-row table (id = 1).
CREATE TABLE IF NOT EXISTS tender_settings (
  id             INT PRIMARY KEY DEFAULT 1,
  digest_enabled BOOLEAN NOT NULL DEFAULT false,
  digest_email   TEXT,
  last_digest_at TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tender_settings_singleton CHECK (id = 1)
);
INSERT INTO tender_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
