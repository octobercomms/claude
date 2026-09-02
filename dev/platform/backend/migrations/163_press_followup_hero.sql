-- Per-release toggle: show the hero image at the foot of follow-up emails
-- (below the sign-off), as a visual reminder of what the story is. Default on.
ALTER TABLE outreach_press_releases
  ADD COLUMN IF NOT EXISTS followup_hero BOOLEAN DEFAULT TRUE;
