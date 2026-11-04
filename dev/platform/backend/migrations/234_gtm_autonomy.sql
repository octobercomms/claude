-- GTM Brain Phase 4: graduated autonomy.
--
-- Per-client action stage controls how far the system acts on its own
-- recommendations. Follows the prThanks pattern exactly: three stages
-- (assist / supervised / auto), the human moves the stage, nothing
-- auto-graduates.
--
-- Review decisions track what the AM did with each recommendation so the
-- track record can show approved vs dismissed vs auto-completed beside
-- the stage picker.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS strategist_action_stage VARCHAR(20) NOT NULL DEFAULT 'assist';

COMMENT ON COLUMN clients.strategist_action_stage IS 'Graduated autonomy: assist (default) | supervised | auto. Human moves the stage.';

ALTER TABLE strategist_briefing_recommendations
  ADD COLUMN IF NOT EXISTS review_decision TEXT,
  ADD COLUMN IF NOT EXISTS review_decision_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_decision_by TEXT;

COMMENT ON COLUMN strategist_briefing_recommendations.review_decision IS 'AM decision: accepted | edited | dismissed | auto_completed. Null = not yet reviewed.';
