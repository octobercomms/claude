-- HeyGen v3 migration. The reel pipeline moves from the legacy
-- /v2/video/generate endpoint to /v3/videos (Avatar IV/V engines, cleaner
-- aspect_ratio, and a `fit` control that actually fills the frame). These
-- columns store the new per-reel choices so a retry re-renders identically.
--
--   fit            -> 'cover' fills the frame (default, fixes the "reel-shaped
--                     but 4:5 content" letterboxing); 'contain' letterboxes.
--   engine         -> null = Avatar IV (default). 'avatar_v' for eligible
--                     digital twins (highest-fidelity lip-sync).
--   expressiveness -> photo avatars only: 'low'|'medium'|'high' motion energy.
--
-- avatar_type (already present) now stores the v3 look type
-- (studio_avatar | digital_twin | photo_avatar) instead of the v2
-- avatar/talking_photo distinction.
ALTER TABLE heygen_reels
  ADD COLUMN IF NOT EXISTS fit            TEXT NOT NULL DEFAULT 'cover',
  ADD COLUMN IF NOT EXISTS engine         TEXT,
  ADD COLUMN IF NOT EXISTS expressiveness TEXT;
