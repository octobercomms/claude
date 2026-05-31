-- Persist how far through the 5-step campaign wizard the AM got, so
-- re-opening a draft jumps straight back to that step instead of
-- forcing them to click Next through every screen again.
--
-- 1 = Campaign details, 2 = Audience, 3 = Contacts, 4 = Emails,
-- 5 = Launch. Default 1 for fresh and historic rows.

ALTER TABLE outreach_campaigns
  ADD COLUMN IF NOT EXISTS wizard_step INT NOT NULL DEFAULT 1;
