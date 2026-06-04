-- Per-client kill switch for the social autopilot. When paused, the
-- publisher cron skips every plan belonging to this client and the AM
-- gets a chance to fix something (wrong account, content review, etc.)
-- without having to delete or unschedule each plan individually.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS social_autopilot_paused BOOLEAN NOT NULL DEFAULT false;
