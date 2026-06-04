-- Link autopilot-published posts back into social_posts so the daily
-- engagement refresh + Winners panel + framework breakdown all include
-- what the autopilot ships. plan_id traces a published post to the
-- source plan in the UI.
ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES social_post_plans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_social_posts_plan_id ON social_posts(plan_id);

-- The autopilot uses one sentinel social_batches row per client to host
-- its published posts. We mark it via a fixed brief string so the
-- service can look it up without a dedicated column. The batches list
-- UI filters this brief out so the autopilot batch doesn't clutter the
-- "Past generations" list.
-- (No DDL required — handled in code.)
