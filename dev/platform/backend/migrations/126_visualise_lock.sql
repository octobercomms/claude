-- Visualise Phase 5: lock a specific step as a variant's approved image, then
-- export it to 4K on demand (docs/omi/visualise-studio.md §7 Lock/Export, D14).
-- Lock is cheap (just a pointer); the upscale spend happens at export time.

ALTER TABLE visualise_variants
  ADD COLUMN IF NOT EXISTS locked_step_id UUID REFERENCES visualise_steps(id) ON DELETE SET NULL;
