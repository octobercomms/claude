-- Where a generated asset came from, now that the asset itself is kept here.
--
-- ad_creative_images.url used to hold whatever the generator returned: a
-- link on Ideogram's, Replicate's, fal's or Adobe's CDN. Those expire within
-- hours or days, so a batch could become undownloadable between approval and
-- launch, and the record gave no sign of it — the link was still well formed,
-- it just answered 404.
--
-- url now holds a local /api/brand/file path and source_url keeps the
-- provider link: worth retrying from while it lives, and it records which
-- provider produced the file.
--
-- stored_bytes is how big the kept file is, and doubles as the flag for
-- whether keeping it worked. NULL means the row still points at a provider
-- URL — either a pre-existing row or one whose download failed — which is
-- what the backfill looks for.

ALTER TABLE ad_creative_images
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS stored_bytes INTEGER;

-- The backfill asks one question: which of this client's assets are still on
-- someone else's CDN? Partial, because once the backfill has run the answer
-- is normally none, and an index over the whole table would be mostly dead
-- weight.
CREATE INDEX IF NOT EXISTS idx_ad_creative_images_unstored
  ON ad_creative_images (creative_id)
  WHERE stored_bytes IS NULL;
