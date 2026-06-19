-- Video Studio: carry the QA grade's structured feedback so a re-edit can act
-- on what was actually wrong, not just trim tighter. The worker's grade stage
-- writes {notes, adjust:{tighten, drop_intro, ...}} here; the next roughcut
-- reads it. See dev/platform/worker/stages/{grade,roughcut}.js.

ALTER TABLE video_projects ADD COLUMN IF NOT EXISTS grade_feedback JSONB;
