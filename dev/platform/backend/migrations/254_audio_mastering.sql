-- What the mastering stage measured, per cleanup.
--
-- audioMaster.js normalises every cleaned recording to -16 LUFS. Without
-- recording what it started from, the screen can only claim the file was
-- improved; with it, the screen can say "was -23.4 LUFS, now -16" — a figure
-- the operator can check against any meter.
--
-- Null means the row predates the mastering stage. A `skipped` key inside it
-- means mastering failed and the isolated audio was delivered unmastered,
-- which is deliberate: a clean but quiet file is worth having, and a cleanup
-- that worked should not be reported as an error because the second stage
-- did not.

ALTER TABLE audio_cleanups ADD COLUMN IF NOT EXISTS mastering JSONB;
