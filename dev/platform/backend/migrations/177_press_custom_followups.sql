-- Let a press campaign use AM-written follow-ups instead of AI-personalised
-- ones. When followups_ai is FALSE, the send path uses the bodies in
-- custom_followups (one per follow-up step, same to everyone, merge tags
-- honoured) rather than generating a per-journalist follow-up — full control,
-- no per-person variation, and no AI spend on follow-ups. Default keeps the
-- existing AI behaviour for every current campaign.
ALTER TABLE outreach_press_releases
  ADD COLUMN IF NOT EXISTS followups_ai     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS custom_followups JSONB   NOT NULL DEFAULT '[]'::jsonb;
