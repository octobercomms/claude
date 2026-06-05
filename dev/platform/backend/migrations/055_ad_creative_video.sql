-- Video support on ad creatives. Up to now ad_creative_images held only
-- still images (Flux via Replicate, Ideogram, Adobe Firefly). Replicate
-- also hosts video models (Seedance, Wan 2.2, Kling, Veo, Hailuo) under
-- the same prediction API, so reusing this table is cheaper than a new
-- one — the only branch is how we render the URL on the frontend.
--
-- media_type tells the frontend whether to use <img> or <video>.
-- duration_seconds is the requested clip length (5 or 10 in practice);
-- nullable because it's meaningless for stills and we don't want to
-- backfill historical image rows.

ALTER TABLE ad_creative_images
  ADD COLUMN IF NOT EXISTS media_type VARCHAR(10) NOT NULL DEFAULT 'image',
  ADD COLUMN IF NOT EXISTS duration_seconds INT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'ad_creative_images_media_type_chk'
  ) THEN
    ALTER TABLE ad_creative_images
      ADD CONSTRAINT ad_creative_images_media_type_chk
      CHECK (media_type IN ('image', 'video'));
  END IF;
END $$;
