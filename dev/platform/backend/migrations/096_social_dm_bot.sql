-- Instagram DM autoresponder — phase 1. Per-client bot persona (the ManyChat
-- "system prompt" / brand voice + FAQs + behaviour) and a library of
-- Claude-drafted reply templates for common triggers. Phase 1 is the brain +
-- the drafts, stored in OMI; the live Meta-messaging webhook is a later phase.
-- See services/dmBot.js.

CREATE TABLE IF NOT EXISTS social_dm_bot (
  client_id   UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  persona     JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {system_prompt, faqs, tone, max_words, escalation}
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS social_dm_templates (
  id          SERIAL PRIMARY KEY,
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  trigger     TEXT,                               -- comment_to_dm | keyword_dm | story_reply | faq | other
  scenario    TEXT,                               -- the situation this reply covers
  reply       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_social_dm_templates_client ON social_dm_templates (client_id, created_at DESC);
