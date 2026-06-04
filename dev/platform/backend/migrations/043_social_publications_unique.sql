-- One publication row per (plan, platform) — the autopilot cron upserts
-- into this table on every retry, so we need a uniqueness target for
-- ON CONFLICT to work. Clear any stray duplicates before adding the
-- constraint (none expected — Phase 2 never inserted into this table —
-- but the DELETE keeps the migration replayable).
DELETE FROM social_post_publications a
  USING social_post_publications b
  WHERE a.id < b.id
    AND a.plan_id = b.plan_id
    AND a.platform = b.platform;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'social_post_publications_plan_platform_unique'
  ) THEN
    ALTER TABLE social_post_publications
      ADD CONSTRAINT social_post_publications_plan_platform_unique
      UNIQUE (plan_id, platform);
  END IF;
END $$;
