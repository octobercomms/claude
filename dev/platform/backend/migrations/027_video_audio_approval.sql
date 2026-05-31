-- Phase 4: video, audio, approval workflow.
--
-- social_post_media holds anything rendered for a post that isn't a still
-- image: UGC videos (Arcads), voiceover MP3s (ElevenLabs), motion
-- graphics (Remotion in future). Multiple per post — you might generate
-- several actor takes of the same script and pick the best.
--
-- approval_links are unauthenticated shareable URLs. Clients open them
-- from email, see the post(s) the AM selected, approve / request
-- changes / leave per-post comments. No login needed; access is gated
-- by the token, which is HMAC-signed and expires.

CREATE TABLE IF NOT EXISTS social_post_media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  kind VARCHAR(20) NOT NULL,        -- video | audio | motion
  provider VARCHAR(30) NOT NULL,    -- arcads | elevenlabs | remotion
  url TEXT NOT NULL,
  duration_sec INT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_post_media_post_id ON social_post_media(post_id);

CREATE TABLE IF NOT EXISTS approval_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  token VARCHAR(64) NOT NULL UNIQUE, -- random opaque token, lookup key
  scope VARCHAR(20) NOT NULL,        -- social_batch | ad_creative_batch | post_list
  scope_id UUID,                     -- batch id when scope is *_batch
  post_ids UUID[] NOT NULL DEFAULT '{}', -- explicit list when scope = post_list
  title TEXT,                        -- e.g. "March social — for your review"
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_links_token ON approval_links(token);
CREATE INDEX IF NOT EXISTS idx_approval_links_client_id ON approval_links(client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS approval_responses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  link_id UUID NOT NULL REFERENCES approval_links(id) ON DELETE CASCADE,
  post_id UUID REFERENCES social_posts(id) ON DELETE SET NULL,
  ad_creative_id UUID REFERENCES ad_creatives(id) ON DELETE SET NULL,
  decision VARCHAR(20),              -- approved | changes_requested | rejected
  comment TEXT,
  reviewer_name VARCHAR(120),        -- whatever the client typed; no auth
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_responses_link_id ON approval_responses(link_id);
