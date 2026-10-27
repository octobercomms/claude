-- Edit-pipeline renders belong in the library too.
--
-- `client_assets` indexed five producing tables and not the sixth. An edit
-- rendered in Produce (trimmed, cleaned, captioned, or stitched from stills)
-- existed only as a row in `edit_jobs`, which means it was reachable by opening
-- the Edit tab and nowhere else: not from the Library, not from Shared's
-- scheduler, not from anything that asks "what have we made for this client".
-- That is the whole question the library exists to answer, and the edits are
-- the single biggest thing October produces.
--
-- Two changes, both narrow: one more allowed value for `source`, and a backfill
-- of the edits already finished.

ALTER TABLE client_assets DROP CONSTRAINT IF EXISTS client_assets_source_check;
ALTER TABLE client_assets ADD CONSTRAINT client_assets_source_check CHECK (source IN (
  'recording', 'video_project', 'social_media', 'ad_creative',
  'design', 'caption_render', 'scene_render', 'upload', 'edit_job'
));

-- The edits already rendered. Only the finished ones with a file: a queued or
-- failed job has no output, and a row claiming an asset that does not exist is
-- worse than a missing row.
--
-- The title prefers the name the operator gave the job, then the source file's
-- name, because "Untitled edit" in a grid of thirty is no use to anyone.
INSERT INTO client_assets (client_id, kind, source, source_id, title, url,
                           created_by, metadata, created_at)
SELECT j.client_id, 'video', 'edit_job', j.id::TEXT,
       COALESCE(NULLIF(j.name, ''), NULLIF(j.source_name, ''), 'Edit'),
       j.output_url, j.created_by,
       jsonb_build_object(
         'aspect', j.ops->>'aspect',
         'caption_template', j.ops->>'caption_template',
         'captions', COALESCE((j.ops->>'captions')::boolean, false),
         'clean_audio', COALESCE((j.ops->>'clean_audio')::boolean, false),
         'srt_url', j.srt_url,
         'backfilled', true),
       j.created_at
  FROM edit_jobs j
 WHERE j.status = 'done'
   AND j.output_url IS NOT NULL AND j.output_url <> ''
ON CONFLICT (source, source_id) DO NOTHING;
