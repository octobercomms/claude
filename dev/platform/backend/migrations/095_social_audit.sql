-- AI Social Audit. Stores the Claude-generated audit of a client's published
-- social performance (content mix, timing, what's working, competitor read,
-- recommendations) run over the engagement data OMI already ingests.
-- See services/socialAudit.js.

CREATE TABLE IF NOT EXISTS social_audits (
  id           SERIAL PRIMARY KEY,
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_days  INTEGER NOT NULL DEFAULT 90,
  post_count   INTEGER NOT NULL DEFAULT 0,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {summary, content_mix, best_timing, whats_working[], whats_not[], competitor_read, recommendations[]}
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_social_audits_client ON social_audits (client_id, generated_at DESC);
