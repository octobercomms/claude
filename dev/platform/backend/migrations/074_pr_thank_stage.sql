-- Thank-you auto-send ramp (graduated autonomy). Per-client trust stage:
--   assist     → nothing auto-sends; the team approves every send (safe default)
--   supervised → auto-send only very high-confidence drafts; the rest wait
--   auto       → auto-send confident drafts; only ambiguous ones wait
-- Claude scores each draft's confidence; a scheduled tick sends the ones that
-- clear the stage threshold. Everything still respects no-repeat memory, a real
-- journalist email, and an active (not on-leave) journalist.

ALTER TABLE pr_client_settings
  ADD COLUMN IF NOT EXISTS thank_stage VARCHAR(20) NOT NULL DEFAULT 'assist';
