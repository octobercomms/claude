-- GTM Brain Phase 1: outcome columns and metric reference.
--
-- Each recommendation can now name which number it is about (metric_ref),
-- record the baseline when raised and the reading when done, and flag
-- qualitative items that cannot be measured.

ALTER TABLE strategist_briefing_recommendations
  ADD COLUMN IF NOT EXISTS metric_ref TEXT,
  ADD COLUMN IF NOT EXISTS baseline_value NUMERIC,
  ADD COLUMN IF NOT EXISTS baseline_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS measurement_window_days INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS outcome_value NUMERIC,
  ADD COLUMN IF NOT EXISTS outcome_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qualitative BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN strategist_briefing_recommendations.metric_ref IS 'Pillar-scoped enum, e.g. paid:roas, owned:top10. Null for qualitative items.';
COMMENT ON COLUMN strategist_briefing_recommendations.measurement_window_days IS 'Days after completion before re-reading the metric. Default 30.';
COMMENT ON COLUMN strategist_briefing_recommendations.qualitative IS 'True for items that cannot be tied to a numeric metric.';
