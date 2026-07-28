-- Subreddit deep research → content angles. One saved snapshot per run: the
-- pain-point analysis + blog topics + reel hooks + reel script + lead-magnet
-- outline, so the AM can revisit and reuse the angles.

CREATE TABLE IF NOT EXISTS subreddit_research (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  subreddit  TEXT NOT NULL,
  focus      TEXT,
  result     JSONB NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subreddit_research_client ON subreddit_research (client_id, created_at DESC);
