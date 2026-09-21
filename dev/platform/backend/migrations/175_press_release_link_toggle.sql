-- Let a press campaign suppress the "Read the release / Download hi-res images
-- & full release" button on the pitch AND the follow-ups. With this off (and
-- "embed full release" also off) the emails go out as plain personal notes —
-- so the same paced, tracked, deliverable pipeline can send a straight
-- invitation or announcement, not only a press pitch. Default TRUE keeps every
-- existing campaign exactly as it sends today.
ALTER TABLE outreach_press_releases
  ADD COLUMN IF NOT EXISTS include_release_link BOOLEAN NOT NULL DEFAULT TRUE;
