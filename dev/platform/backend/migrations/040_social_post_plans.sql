-- Conversational social post planner — each row is one detailed
-- plan for a single post (or post series). The AM iterates with
-- Claude in a chat modal until happy, then locks the JSON plan
-- here. Exports as PDF / Word for handing to whoever's filming.
--
-- Replaces the per-batch generation flow eventually (still side-by-
-- side during the validation window). plan is the full structured
-- brief: title, platforms, scenes[], equipment, captions, reuse
-- plan, approval gates — schema lives in src/services/socialPlanner.js.

CREATE TABLE IF NOT EXISTS social_post_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled plan',
  plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_post_plans_client ON social_post_plans(client_id, updated_at DESC);
