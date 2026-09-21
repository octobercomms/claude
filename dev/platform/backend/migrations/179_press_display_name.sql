-- A friendly, AM-chosen name for a press campaign. The list previously showed
-- the raw press-release headline (often a long, formal title), which is hard to
-- scan when you run several campaigns. display_name is an optional nickname the
-- AM can set/rename inline; the UI falls back to the headline (title) when it's
-- empty, so existing campaigns are unchanged.
ALTER TABLE outreach_press_releases
  ADD COLUMN IF NOT EXISTS display_name TEXT;
