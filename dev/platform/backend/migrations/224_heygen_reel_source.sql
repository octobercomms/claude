-- Keep the avatar reels.
--
-- heygen_reels.video_url held the URL HeyGen returned. Those are presigned
-- links with a lifetime measured in days, so the row outlived the file: the
-- account lead's older reels played as blank video and opening one in a new
-- tab answered "access denied".
--
-- Reported on 31 Oct, the same day the identical fault was fixed for ad
-- creative (223). Same shape of fix, same columns, same service:
-- services/generatedMedia.js fetches the bytes when the render completes and
-- video_url becomes a local /api/brand/file path.
--
-- source_url keeps HeyGen's link, which is worth retrying from while it
-- lives. stored_bytes is the size and doubles as the flag for whether
-- keeping it worked: NULL means the row still points at HeyGen.

ALTER TABLE heygen_reels
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS stored_bytes INTEGER;

-- The backfill's one question: which of this client's finished reels are
-- still on HeyGen? Partial, because after the backfill runs the answer is
-- normally none.
CREATE INDEX IF NOT EXISTS idx_heygen_reels_unstored
  ON heygen_reels (client_id)
  WHERE stored_bytes IS NULL AND status = 'completed';
