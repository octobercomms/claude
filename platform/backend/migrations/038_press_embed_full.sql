-- Press releases can now be embedded in the body of the first email so
-- the journalist sees the full release inline rather than just a link.
-- Default ON: better to over-share than to send an email that lacks the
-- actual story. The toggle is per-release so the AM can flip back to
-- "link only" for releases under embargo or with very long bodies.

ALTER TABLE outreach_press_releases
  ADD COLUMN IF NOT EXISTS embed_full_release BOOLEAN NOT NULL DEFAULT TRUE;
