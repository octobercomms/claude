-- Phase 8: trending TikTok sounds + framework analytics.
--
-- social_posts.framework  - stored explicitly now rather than parsed out
--                           of the notes blob. Used by the Winners panel
--                           to break engagement down by framework (PAS,
--                           AIDA, etc.) so the AM can see what's
--                           actually moving the needle for this client.
--
-- trending_sounds_snapshots - one row per (client, fetched_at) holding
--                           the Apify TikTok scrape result. Cached so
--                           repeat reads in the same week don't burn
--                           Apify credits.

ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS framework VARCHAR(40);

CREATE INDEX IF NOT EXISTS idx_social_posts_framework ON social_posts(client_id, framework);

-- Backfill framework on existing rows by grabbing the leading token from
-- the notes column (Phase 2 stored "<framework> — <rationale>" in notes).
UPDATE social_posts
   SET framework = SPLIT_PART(notes, ' — ', 1)
 WHERE framework IS NULL AND notes IS NOT NULL AND notes <> '';

CREATE TABLE IF NOT EXISTS trending_sounds_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  region VARCHAR(8) NOT NULL DEFAULT 'GB',
  sounds JSONB NOT NULL DEFAULT '[]',
  source VARCHAR(40) NOT NULL DEFAULT 'apify'
);

CREATE INDEX IF NOT EXISTS idx_trending_sounds_client_id
  ON trending_sounds_snapshots(client_id, fetched_at DESC);
