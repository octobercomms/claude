-- Autopilot schedule + Drive folder + target platforms on each locked
-- social post plan. Once the AM has shot the content into the Drive
-- folder, the scheduler picks the plan up at scheduled_at and publishes
-- to every platform in target_platforms.
--
-- One social_post_publications row is created per (plan, platform) when
-- the scheduler kicks off. Captions are generated per-platform at
-- publish time, not lock time, so we can adapt to platform-specific
-- conventions without re-locking the plan.

ALTER TABLE social_post_plans
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS drive_folder_url TEXT,
  ADD COLUMN IF NOT EXISTS target_platforms TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS social_post_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES social_post_plans(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,             -- instagram | facebook | linkedin
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | publishing | posted | failed | cancelled
  caption TEXT,
  media_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  posted_at TIMESTAMPTZ,
  posted_url TEXT,
  error_message TEXT,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_publications_plan ON social_post_publications(plan_id);
CREATE INDEX IF NOT EXISTS idx_social_publications_due
  ON social_post_publications(scheduled_at) WHERE status = 'pending';
