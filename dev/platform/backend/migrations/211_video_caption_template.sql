-- Which caption template a project renders with.
--
-- The templates themselves live in shared/captions/presets.json rather than in
-- a table, on purpose: a template is only meaningful alongside the compiler
-- that understands its animationType, so the two ship together. What belongs
-- here is the operator's choice, which is a per-project fact.
--
-- NULL means no word-timed captions, which is the existing behaviour and stays
-- the default: a project created before this column existed renders exactly as
-- it did yesterday.
ALTER TABLE video_projects
  ADD COLUMN IF NOT EXISTS caption_template VARCHAR(40);

COMMENT ON COLUMN video_projects.caption_template IS
  'id from shared/captions/presets.json, or NULL for no word-timed captions.';
