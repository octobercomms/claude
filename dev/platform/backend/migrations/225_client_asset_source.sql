-- Keep the library's clips.
--
-- The third of the same fault, reported on the same review: "when I clicked on
-- an old clip it said That clip is not on this server any more."
--
-- client_assets.url holds whatever the producing system gave it, which for a
-- provider render is that provider's CDN link. Those expire, so the row
-- outlives the file, and nothing recorded where the bytes had come from.
--
-- There is a second fault in front of it, which is the one that produced the
-- message. socialCaptionRender.localPath hands an external URL straight back
-- so ffmpeg can read https directly; the Edit route then tested the result
-- with fs.existsSync, which a URL always fails. So Edit refused every
-- CDN-hosted clip in the library, including the ones whose link still worked.
--
-- Same columns and same service as 223 (ad creative) and 224 (avatar reels):
-- services/generatedMedia.js fetches the bytes and `url` becomes a local
-- /api/brand/file path. source_url keeps the provider link, worth retrying
-- from while it lives. stored_bytes is the size and doubles as the flag for
-- whether keeping it worked.

ALTER TABLE client_assets
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS stored_bytes BIGINT;

-- Which of a client's live assets still point at somebody else's server.
-- Partial, because once a clip has been opened in Edit the answer for it is
-- no, and the normal state of this index is close to empty.
CREATE INDEX IF NOT EXISTS idx_client_assets_unstored
  ON client_assets (client_id)
  WHERE archived_at IS NULL AND stored_bytes IS NULL AND url LIKE 'http%';
