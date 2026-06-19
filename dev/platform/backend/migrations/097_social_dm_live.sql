-- Instagram DM autoresponder — phase 2: live auto-send via Meta. Extends the
-- per-client bot config with the Instagram account it answers for and the Page
-- token used to send replies, plus an on/off switch. A single signature-verified
-- webhook (/api/social/dm-webhook) routes incoming DMs/comments to the matching
-- client by ig_user_id. social_dm_events logs every inbound/outbound message
-- (audit + dedupe). See services/metaMessaging.js.

ALTER TABLE social_dm_bot ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE social_dm_bot ADD COLUMN IF NOT EXISTS ig_user_id TEXT;            -- IG business account id Meta keys events by
ALTER TABLE social_dm_bot ADD COLUMN IF NOT EXISTS page_token_encrypted JSONB; -- Page access token (instagram_manage_messages), encrypted

CREATE INDEX IF NOT EXISTS idx_social_dm_bot_ig ON social_dm_bot (ig_user_id) WHERE ig_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS social_dm_events (
  id           SERIAL PRIMARY KEY,
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  direction    TEXT NOT NULL,                      -- in | out
  channel      TEXT NOT NULL DEFAULT 'dm',         -- dm | comment
  external_id  TEXT,                               -- message mid / comment id (dedupe)
  counterparty TEXT,                               -- sender/recipient id
  text         TEXT,
  status       TEXT,                               -- replied | skipped | error | escalated
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_social_dm_events_client ON social_dm_events (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_dm_events_extid ON social_dm_events (external_id) WHERE external_id IS NOT NULL;
