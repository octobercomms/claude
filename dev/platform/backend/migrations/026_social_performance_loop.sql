-- Phase 3: performance loop + Adobe Firefly + Photoshop generative resize.
--
-- social_posts gets the fields needed to track a post after it goes live:
--   published_url      — the canonical IG/TikTok/LinkedIn URL the AM pasted
--   external_id        — the parsed platform-side id (e.g. IG media id)
--   external_platform  — duplicate of platform but kept editable in case the
--                        AM re-targeted the post to a different network
--   published_at       — when they marked it published
--
-- social_post_engagement holds the time-series snapshots we pull from the
-- platform APIs. One row per (post, fetched_at) so we can chart growth and
-- recompute "winners this month" from any window.

ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS published_url TEXT;
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS external_platform VARCHAR(20);
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS social_post_engagement (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  impressions INT,
  reach INT,
  views INT,
  likes INT,
  comments INT,
  shares INT,
  saves INT,
  watch_time_sec INT,
  raw JSONB,
  UNIQUE(post_id, fetched_at)
);

CREATE INDEX IF NOT EXISTS idx_social_post_engagement_post_id
  ON social_post_engagement(post_id, fetched_at DESC);
