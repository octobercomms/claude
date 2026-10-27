-- The client asset library: one place that knows what October has made.
--
-- Before this, a produced asset could land in any of five tables, each with its
-- own shape and its own idea of what an asset is:
--
--   social_post_media      a reel or voiceover, tied to a post, no client_id
--   recordings             a screen recording, by storage key rather than url
--   video_projects         a finished edit, in output_url, integer primary key
--   design_pages           a design, thumbnail only, no exported output
--   ad_creative_images     an ad image, tied to a creative, no client_id
--
-- Which meant nothing in OMI could answer "show me everything we have made for
-- this client". Not the scheduler, not an account manager, not the client. That
-- is the question this table exists to answer, and until it could be answered,
-- scheduling from a library and reusing a reel across channels were both
-- impossible.
--
-- This does NOT replace those tables. Each stays the record of its own
-- production run, with its own lifecycle; this is the index across them. A row
-- here says an asset exists, what it is and where it came from.

CREATE TABLE IF NOT EXISTS client_assets (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- What it is, for filtering and for knowing how to render a thumbnail.
  kind         TEXT NOT NULL CHECK (kind IN ('video', 'image', 'audio', 'document')),

  -- Where it came from. `source` names the producing system and `source_id` is
  -- that system's own key, as TEXT because video_projects uses a SERIAL integer
  -- while everything else uses a UUID. Together they are unique, so a producer
  -- that records the same output twice updates rather than duplicates.
  source       TEXT NOT NULL CHECK (source IN (
                 'recording', 'video_project', 'social_media', 'ad_creative',
                 'design', 'caption_render', 'scene_render', 'upload')),
  source_id    TEXT NOT NULL,

  title        TEXT NOT NULL DEFAULT '',
  -- Exactly one of these is set. A url is fetchable as-is; a storage_key needs
  -- the media store to resolve it, which is how recordings work.
  url          TEXT,
  storage_key  TEXT,

  mime         TEXT,
  width        INT,
  height       INT,
  duration_s   NUMERIC(10,2),
  bytes        BIGINT,

  -- Anything the producer wants to carry: the caption template used, the
  -- aspect ratio, the provider, the prompt. Searchable without a schema change.
  metadata     JSONB NOT NULL DEFAULT '{}',

  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Soft delete: an asset referenced by a scheduled post must not vanish from
  -- under it, and "we made this and then removed it" is itself worth knowing.
  archived_at  TIMESTAMPTZ,

  CONSTRAINT client_assets_has_a_location CHECK (url IS NOT NULL OR storage_key IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_client_assets_source
  ON client_assets(source, source_id);
CREATE INDEX IF NOT EXISTS idx_client_assets_client
  ON client_assets(client_id, kind, created_at DESC) WHERE archived_at IS NULL;

COMMENT ON TABLE client_assets IS
  'Index of every asset October has produced for a client. The producing tables '
  'remain the record of each production run; this is what makes them findable.';

-- --- the backfill -----------------------------------------------------------
--
-- Written so the library is useful on the day it ships rather than only for
-- what is made after it. Every statement is ON CONFLICT DO NOTHING against the
-- (source, source_id) index, so re-running the migration adds nothing and
-- changes nothing.
--
-- design_projects is deliberately absent. A design has no exported output
-- until someone exports it: design_pages carries a thumbnail, which is a
-- preview rather than the asset. Indexing thumbnails as if they were finished
-- work would fill the library with things nobody can use.

-- Finished video edits.
INSERT INTO client_assets (client_id, kind, source, source_id, title, url, metadata, created_at)
SELECT vp.client_id, 'video', 'video_project', vp.id::TEXT,
       COALESCE(NULLIF(vp.name, ''), 'Untitled edit'), vp.output_url,
       jsonb_build_object('style_preset', vp.style_preset, 'score', vp.score,
                          'backfilled', true),
       vp.created_at
  FROM video_projects vp
 WHERE vp.output_url IS NOT NULL AND vp.output_url <> ''
ON CONFLICT (source, source_id) DO NOTHING;

-- Screen recordings. Only the ones that finished uploading: a part-file is not
-- an asset, and status tells us which is which.
INSERT INTO client_assets (client_id, kind, source, source_id, title, storage_key,
                           mime, duration_s, bytes, created_by, metadata, created_at)
SELECT r.client_id, 'video', 'recording', r.id::TEXT,
       COALESCE(NULLIF(r.title, ''), 'Untitled recording'), r.storage_key,
       r.mime, r.duration_s, r.size_bytes, r.created_by,
       jsonb_build_object('has_transcript', r.transcript IS NOT NULL, 'backfilled', true),
       r.created_at
  FROM recordings r
 WHERE r.client_id IS NOT NULL
   AND r.storage_key IS NOT NULL AND r.storage_key <> ''
   AND r.status = 'ready'
ON CONFLICT (source, source_id) DO NOTHING;

-- Reels and voiceovers produced against a social post. The client comes from
-- the post, since this table never carried one.
INSERT INTO client_assets (client_id, kind, source, source_id, title, url,
                           duration_s, metadata, created_at)
SELECT sp.client_id,
       CASE WHEN spm.kind = 'audio' THEN 'audio' ELSE 'video' END,
       'social_media', spm.id::TEXT,
       CONCAT(INITCAP(spm.kind), ' for a social post'), spm.url,
       spm.duration_sec,
       spm.metadata || jsonb_build_object('provider', spm.provider,
                                          'post_id', spm.post_id, 'backfilled', true),
       spm.created_at
  FROM social_post_media spm
  JOIN social_posts sp ON sp.id = spm.post_id
 WHERE spm.url IS NOT NULL AND spm.url <> ''
ON CONFLICT (source, source_id) DO NOTHING;

-- Ad creative images, through the creative that owns them.
INSERT INTO client_assets (client_id, kind, source, source_id, title, url, metadata, created_at)
SELECT ac.client_id, 'image', 'ad_creative', aci.id::TEXT,
       'Ad creative', aci.url,
       jsonb_build_object('provider', aci.provider, 'aspect_ratio', aci.aspect_ratio,
                          'prompt', aci.prompt, 'creative_id', aci.creative_id,
                          'backfilled', true),
       aci.created_at
  FROM ad_creative_images aci
  JOIN ad_creatives ac ON ac.id = aci.creative_id
 WHERE aci.url IS NOT NULL AND aci.url <> ''
ON CONFLICT (source, source_id) DO NOTHING;
