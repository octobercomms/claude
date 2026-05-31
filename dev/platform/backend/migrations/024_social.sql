-- Social suite — Phase 1.
--   social_batches:   one row per "generate 9 posts" call. Holds the brief
--                     used, the exemplars + trends Claude was given, and a
--                     timestamp so the AM can browse past generations.
--   social_posts:     one row per post inside a batch. Each post carries
--                     the platform target, hook, caption, hashtags, the
--                     frame-by-frame storyboard, and (optionally) the
--                     image URLs once they're rendered via Replicate /
--                     Ideogram.
--   clients.social_competitors:
--                     up to 6 "platform:handle" strings per client (e.g.
--                     "instagram:falconenamel"). Used as the seed for
--                     pulling top-performing exemplars.

CREATE TABLE IF NOT EXISTS social_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  brief TEXT,
  exemplars JSONB,
  trends JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_batches_client_id ON social_batches(client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS social_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID NOT NULL REFERENCES social_batches(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL DEFAULT 0,
  kind VARCHAR(20) NOT NULL DEFAULT 'post',     -- post | reel | story | carousel
  platform VARCHAR(20) NOT NULL DEFAULT 'instagram',
  hook TEXT,
  caption TEXT,
  hashtags TEXT[] NOT NULL DEFAULT '{}',
  visual_concept TEXT,
  storyboard JSONB,                              -- array of { frame, shot, on_screen_text, voiceover }
  image_urls TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',   -- draft | approved | scheduled | published
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_posts_batch_id ON social_posts(batch_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_client_id ON social_posts(client_id, created_at DESC);

CREATE TRIGGER update_social_posts_updated_at BEFORE UPDATE ON social_posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS social_competitors TEXT[] NOT NULL DEFAULT '{}';
