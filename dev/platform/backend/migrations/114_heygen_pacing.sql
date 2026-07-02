-- HeyGen pacing: per-reel voice speed (v3 voice_settings.speed, 0.5–1.5).
-- NULL = HeyGen default (1.0). Stored so a retry re-renders at the same pace.
-- Pauses stay script-driven ([pause Ns] → SSML <break>) and need no column.
ALTER TABLE heygen_reels
  ADD COLUMN IF NOT EXISTS speed NUMERIC;
