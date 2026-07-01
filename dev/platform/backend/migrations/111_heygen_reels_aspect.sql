-- Let the AM pick the video shape (reel / post / square / landscape) per reel.
-- Stored so a retry re-renders at the same shape. '9:16' keeps the old default.
ALTER TABLE heygen_reels
  ADD COLUMN IF NOT EXISTS aspect_ratio TEXT NOT NULL DEFAULT '9:16';
