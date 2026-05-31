-- Per-client toggles for which sections appear in weekly/monthly reports.
-- NULL means "include everything" (the prior behaviour).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS report_sections JSONB;
