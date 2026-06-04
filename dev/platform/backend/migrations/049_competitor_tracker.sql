-- Weekly competitor scrape store. The Sunday 06:00 cron walks each
-- client's social_competitors handles, asks Apify for the latest reels
-- (or top posts), and lands the results here. The Social tab surfaces
-- them so the AM sees what the brand's competitive set is shipping —
-- and the same rows feed into the next batch's prompt as exemplars
-- alongside the brand's own Winners.
--
-- Idempotent on (client_id, platform, external_id): a second scrape
-- for the same post updates view_count + likes_count rather than
-- creating a duplicate, so we get a moving view-count trend over
-- successive Sundays for free.

CREATE TABLE IF NOT EXISTS competitor_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform VARCHAR(20) NOT NULL,     -- 'instagram' | 'tiktok'
  handle VARCHAR(120) NOT NULL,
  external_id TEXT NOT NULL,
  post_url TEXT,
  thumbnail_url TEXT,
  caption TEXT,
  hook TEXT,                          -- first line of caption — used as the AM-facing summary
  view_count BIGINT,
  likes_count BIGINT,
  comments_count BIGINT,
  posted_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT competitor_posts_unique UNIQUE (client_id, platform, external_id)
);

CREATE INDEX IF NOT EXISTS idx_competitor_posts_client_fetched
  ON competitor_posts(client_id, fetched_at DESC);
