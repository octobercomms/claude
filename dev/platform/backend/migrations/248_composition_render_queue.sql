-- The composition render queue becomes a queue.
--
-- Migration 241 created composition_renders as a RECORD of a render. It was
-- never a queue: the actual queue was two module-level variables in
-- routes/compose.js, `_activeRender` and `_renderQueue`, holding closures. One
-- ffmpeg ran at a time per Node process, and every pending item died with the
-- process, leaving its row at 'queued' with nothing anywhere that could run
-- it. No code selected 'queued' rows to resume them. A deploy mid-batch
-- abandoned the rest of the batch silently, and /render-status went on
-- reporting 'queued' forever.
--
-- Three columns fix that, and they are the same three the repo's one proven
-- queue uses (video_jobs, migration 090, claimed with FOR UPDATE SKIP LOCKED
-- and drained by the worker box):
--
--   claimed_at  when a runner took this row. NULL means nobody holds it.
--   claimed_by  which runner, so a log says where a render went.
--   attempts    how many times it has been claimed, so a row that kills its
--               runner every time stops rather than looping for ever.
--
-- The two partial indexes matter more than they look. An index over every
-- status would be mostly 'done' rows, which is the bulk of the table and
-- exactly the part no query wants. Indexing only the waiting and the in-flight
-- keeps the claim and the reaper reading a handful of rows no matter how many
-- renders the table has accumulated.

ALTER TABLE composition_renders
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_by TEXT,
  ADD COLUMN IF NOT EXISTS attempts  INTEGER NOT NULL DEFAULT 0;

-- The claim reads this: oldest queued first, so a batch runs in the order it
-- was submitted and one client's thirty cannot jump another client's one.
CREATE INDEX IF NOT EXISTS idx_comp_renders_queued
  ON composition_renders (created_at)
  WHERE status = 'queued';

-- The reaper reads this: rows claimed long enough ago that their runner is
-- gone. Without it, a runner killed mid-render strands its row for ever —
-- which is true of every other queue in this repo as well, none of which has
-- a reaper.
CREATE INDEX IF NOT EXISTS idx_comp_renders_claimed
  ON composition_renders (claimed_at)
  WHERE status = 'rendering';

-- `id` as the tiebreak for "the latest render of this composition". The route
-- ordered by created_at alone, which defaults to now() — transaction-start
-- time — so two rows inserted in one transaction share it exactly and the
-- winner was whichever the planner happened to return.
CREATE INDEX IF NOT EXISTS idx_comp_renders_latest
  ON composition_renders (composition_id, id DESC);

-- A budget that can actually refuse a batch.
--
-- `assertUnderTaskCap` returns silently for a task with no row, and there was
-- no video_batch row: the name existed only as a JSDoc example in
-- FeatureCost.jsx. So the cap the plan describes was a no-op.
--
-- The feature list is deliberately short and honest. A Path B batch invents no
-- pixels and calls no hosted model, so a stills montage costs nothing but CPU;
-- the only API money a batch spends today is transcribing speech, which is
-- what `composition_transcribe` records. More features join this array as the
-- runner grows, and the cap is per-task rather than per-feature so that adding
-- one does not need a new budget.
INSERT INTO ai_task_budgets (task, label, features, monthly_cap_usd, note)
VALUES (
  'video_batch',
  'Video batches',
  ARRAY['composition_transcribe'],
  25.00,
  'Unattended batch video. A Path B batch renders with ffmpeg and invents no frames, so most of a run costs CPU rather than API credit; this caps the speech transcription it does pay for.'
)
ON CONFLICT (task) DO NOTHING;
