-- Composition renders get their own asset source, and a retention rule.
--
-- They were recorded as `scene_render`, which is a different feature: the
-- scene templates in Produce, built from a handful of images, whose source ids
-- look like `scene-<timestamp>-<hex>.mp4`. A composition render's look like
-- `render-<compositionId>-<jobId>` and carry a `composition_id` in their
-- metadata, so the two are distinguishable — but nothing distinguished them.
--
-- Two consequences, and a batch of thirty a fortnight makes both matter. The
-- Library shows every one of them as "Scene template", so an operator cannot
-- tell what they are looking at. And `assets.archiveBySource('scene_render',
-- …)` would archive a scene render when a composition render's file went, or
-- the reverse, which is why the disk sweep could not be pointed at them at all.
--
-- `video-clips` and `video-outputs` are swept at 03:15 and these land in
-- `uploads/<client>/`, so until now a composition render was kept forever.

ALTER TABLE client_assets DROP CONSTRAINT IF EXISTS client_assets_source_check;
ALTER TABLE client_assets ADD CONSTRAINT client_assets_source_check CHECK (source IN (
  'recording', 'video_project', 'social_media', 'ad_creative',
  'design', 'caption_render', 'scene_render', 'upload', 'edit_job',
  'composition'
));

-- The renders already made. Targeted on the metadata rather than the source id
-- pattern, because the metadata is what the writer puts there deliberately and
-- a naming convention is what somebody changes without noticing.
UPDATE client_assets
   SET source = 'composition'
 WHERE source = 'scene_render'
   AND metadata ? 'composition_id';
