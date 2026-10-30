-- Worked examples across the pillars.
--
-- Paid has had one since 122_ad_creative_example_batch: a real batch, drawn
-- from the client's own profile and badged "Example", so a brand-new client
-- has something that flows through every Build step and can be shown to a
-- client without being mistaken for approved work.
--
-- Shared, Earned and Owned had nothing, so a newly set-up client opened three
-- empty pages. Same flag, same meaning, on each pillar's own content table.
--
-- The badge matters as much as the row. An example that cannot be told apart
-- from real work is worse than no example, because somebody eventually sends
-- it to a client.

ALTER TABLE social_batches
  ADD COLUMN IF NOT EXISTS is_example BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE content_drafts
  ADD COLUMN IF NOT EXISTS is_example BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE pr_press_releases
  ADD COLUMN IF NOT EXISTS is_example BOOLEAN NOT NULL DEFAULT false;

-- Each pillar's "has this client got an example yet?" lookup, which the
-- idempotency check runs on every call.
CREATE INDEX IF NOT EXISTS idx_social_batches_example
  ON social_batches(client_id) WHERE is_example;
CREATE INDEX IF NOT EXISTS idx_content_drafts_example
  ON content_drafts(client_id) WHERE is_example;
CREATE INDEX IF NOT EXISTS idx_pr_press_releases_example
  ON pr_press_releases(client_id) WHERE is_example;
