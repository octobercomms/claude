-- Mark a batch as the auto-generated "worked example" so it can be shown
-- across the Build pipeline (Brief → Draft → Render → Approve → Launch) and
-- kept distinct from the AM's real briefs. One example per client, generated
-- on demand from the client profile; safe to delete.
ALTER TABLE ad_creative_batches
  ADD COLUMN IF NOT EXISTS is_example BOOLEAN NOT NULL DEFAULT false;
