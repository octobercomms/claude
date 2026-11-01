-- Render progress and cancellation for edit jobs.
--
-- A trim takes seconds; a timeline render over several clips takes minutes,
-- because every block is cut and normalised before the concat. A spinner is an
-- honest answer to "is this working?" for the first kind and a useless one for
-- the second: it cannot tell a render that is 80% done from one that has hung,
-- and the operator's only options are to wait or to give up on the whole edit.
--
-- `progress` is 0 to 100 and `stage` names what is happening, because a bare
-- percentage on a multi-pass render is a number nobody can check. The stage is
-- what makes the number readable: "cutting block 3 of 7" is verifiable against
-- the timeline on screen in a way that "41%" is not.
--
-- Cancellation is a status, not a column: 'cancelled' joins
-- draft/queued/processing/done/failed, and the column has no CHECK constraint
-- so nothing has to be widened for it.

ALTER TABLE edit_jobs ADD COLUMN IF NOT EXISTS progress SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE edit_jobs ADD COLUMN IF NOT EXISTS stage TEXT;

-- The queue index covers 'queued' only, so a cancelled job leaves it the moment
-- its status changes and is never claimed. Nothing to add there.

COMMENT ON COLUMN edit_jobs.progress IS
  'Render progress 0-100. An estimate across passes, not a measurement: see stage.';
COMMENT ON COLUMN edit_jobs.stage IS
  'What the renderer is doing now, e.g. "cutting block 3 of 7". Null when not processing.';
