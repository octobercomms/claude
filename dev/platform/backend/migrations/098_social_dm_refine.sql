-- DM autoresponder refinements: comment-trigger keywords, an optional public
-- comment reply, and a per-client opt-out list (compliance: someone who says
-- "stop" must never be messaged again). See services/metaMessaging.js.

ALTER TABLE social_dm_bot ADD COLUMN IF NOT EXISTS comment_keywords TEXT[] NOT NULL DEFAULT '{}';   -- only comment-to-DM when a comment matches one of these (empty = any comment)
ALTER TABLE social_dm_bot ADD COLUMN IF NOT EXISTS public_reply BOOLEAN NOT NULL DEFAULT FALSE;       -- also post a public reply to the comment
ALTER TABLE social_dm_bot ADD COLUMN IF NOT EXISTS public_reply_text TEXT;                            -- the public reply (defaults to a short nudge)

CREATE TABLE IF NOT EXISTS social_dm_optouts (
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  counterparty TEXT NOT NULL,                          -- the IG user id who opted out
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, counterparty)
);
