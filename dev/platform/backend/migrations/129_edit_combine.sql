-- Edit studio phase 2: combine multiple clips into one video, plus a rename.
-- `clips` holds the ordered input list [{url,name}] (one entry for a normal
-- single-clip edit, several for a combine). `name` is an optional user label so
-- a growing edit history stays scannable. `source_url` stays as the primary/
-- thumbnail clip for back-compat.

ALTER TABLE edit_jobs ADD COLUMN IF NOT EXISTS clips JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE edit_jobs ADD COLUMN IF NOT EXISTS name TEXT;
