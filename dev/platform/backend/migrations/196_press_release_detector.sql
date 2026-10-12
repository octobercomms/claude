-- The detector's reading, stored beside October's own on the release itself.
--
-- Separate from the checker bench (migration 195), which is a temporary
-- calibration corpus and goes when the thresholds are set. This is the ongoing
-- use: run the detector before issuing a release, keep the answer with the
-- release, and let the pair accumulate as a by-product of normal work rather
-- than as a research exercise.
--
-- pangram_json holds the provider's whole response plus a fingerprint of the
-- text it described. The fingerprint is what stops a re-check of unchanged
-- text being billed twice, and keeping the raw body means a wrong guess about
-- which field carries the percentage costs a display value and never the data.
ALTER TABLE pr_press_releases
  ADD COLUMN IF NOT EXISTS pangram_pct        NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS pangram_json       JSONB,
  ADD COLUMN IF NOT EXISTS pangram_checked_at TIMESTAMPTZ;

COMMENT ON COLUMN pr_press_releases.pangram_pct IS
  'Last detector reading, percent of the text read as machine-written. Advisory, and never blocks issuing a release.';
COMMENT ON COLUMN pr_press_releases.pangram_json IS
  'The provider response in full, plus fingerprint (sha256 of the checked text) and the OMI score at the time, so the pair can be read back later.';
