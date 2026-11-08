-- A machine verdict on each rendered file.
--
-- Thirty unattended renders are only useful if the review sheet can say which
-- two to watch first. Without that, "a batch saved me an afternoon" becomes
-- "a batch gave me thirty videos to watch", which is the same afternoon.
--
-- `qc_verdict` is the one word the sheet sorts and filters on:
--
--   fail       something measurably broken: black in the middle, a frozen
--              two seconds, the wrong resolution, a camera move that did not
--              happen. Mostly a re-render.
--   look       suspicious but possibly intended: a long silent tail, audio
--              and video of different lengths, a peak near clipping.
--   pass       nothing measured is wrong. Still worth a glance, because no
--              measurement can tell you whether the edit is any good.
--   unmeasured the file could not be measured. The video still exists and a
--              person can still watch it, so this is a thing to say rather
--              than a failure.
--
-- `qc` holds the whole report: every check with its level, its sentence and
-- where in the video to look, plus the raw measurements and the fingerprint of
-- the thresholds used. The fingerprint matters because a verdict stored last
-- month was judged by last month's numbers, and comparing it with today's
-- without knowing that is how a rule change looks like a quality change.
--
-- `qc_rank` is what the sheet actually ORDER BYs: severity first, then how
-- many separate things are wrong, so the operator's first click is the most
-- broken video rather than the first one submitted.
--
-- No CHECK constraint on the verdict. The vocabulary belongs to
-- shared/renderQc.mjs, and a constraint here would mean a migration every
-- time a level is added — with the failure landing as a render that cannot
-- record its own result.

ALTER TABLE composition_renders
  ADD COLUMN IF NOT EXISTS qc         JSONB,
  ADD COLUMN IF NOT EXISTS qc_verdict TEXT,
  ADD COLUMN IF NOT EXISTS qc_rank    INTEGER;

-- The sheet's own read: a batch's items, worst first. Partial, because a row
-- with no verdict yet is not something the sheet orders by, and the finished
-- renders are the minority of this table over time.
CREATE INDEX IF NOT EXISTS idx_comp_renders_qc
  ON composition_renders (qc_rank DESC)
  WHERE qc_verdict IS NOT NULL;
