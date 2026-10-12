-- The checker bench: a labelled corpus for calibrating the humanity checker.
--
-- Deliberately separate from pr_press_releases. These are not releases October
-- is issuing; they are specimens, loaded to be measured. Keeping them apart
-- means the bench can be deleted in one migration when the calibration is done,
-- without touching a single live release.
--
-- The point of the table is the PAIR: October's own score and a trained
-- detector's score for the same text, with a human label saying how the text
-- was actually produced. One row is an anecdote. Thirty rows say whether the
-- deterministic checker predicts anything at all.
CREATE TABLE IF NOT EXISTS checker_samples (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title              TEXT NOT NULL DEFAULT '',
  -- How the text was actually produced, which is the only ground truth here.
  -- Four levels rather than two: a binary human/AI label throws away the middle,
  -- and the middle — an AI draft a person then reported into — is where
  -- October's own work sits and where the detectors disagree most.
  label              TEXT NOT NULL
                       CHECK (label IN ('cold', 'ai_rewritten', 'ai_edited', 'ai_raw', 'unknown')),
  body_html          TEXT NOT NULL DEFAULT '',
  word_count         INTEGER,
  note               TEXT NOT NULL DEFAULT '',

  -- October's reading, recomputed in bulk whenever the analyser changes, so a
  -- weights change can be measured against the whole corpus in one click.
  own_score          INTEGER,
  own_json           JSONB,
  own_scored_at      TIMESTAMPTZ,
  -- The analyser's version at the time, so a mixed-vintage table is detectable.
  own_version        TEXT,

  -- The detector's reading. Costs money, so it is never recomputed in bulk and
  -- never fired by anything but an explicit button.
  pangram_pct        NUMERIC(5,2),
  pangram_json       JSONB,
  pangram_checked_at TIMESTAMPTZ,
  pangram_cost_usd   NUMERIC(10,4),

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checker_samples_label ON checker_samples (label);

COMMENT ON TABLE checker_samples IS
  'Calibration corpus for the humanity checker. Temporary: drop it once the thresholds are set.';
COMMENT ON COLUMN checker_samples.label IS
  'Ground truth, from the operator: cold = written from scratch; ai_rewritten = AI draft rewritten by hand; ai_edited = AI draft tidied; ai_raw = essentially as generated.';

-- Pangram is billed per 100 words, so it gets its own allowance under the same
-- machinery as the Claude tasks. A bench run over thirty releases is about $10,
-- and the cap is what stops a stray loop turning that into a month's spend.
INSERT INTO ai_task_budgets (task, label, features, monthly_cap_usd, note)
VALUES (
  'detector_check',
  'AI detector checks',
  ARRAY['pangram_detect'],
  25.00,
  'Pangram AI detection, billed per 100 words. One call per button press, never automatic, and a re-check of unchanged text is served from the stored result. Change or pause in Settings → AI models.'
)
ON CONFLICT (task) DO NOTHING;
