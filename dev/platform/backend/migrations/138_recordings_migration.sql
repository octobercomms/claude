-- Migration support for the in-OMI recorder: importing existing videos (e.g.
-- from Loom) needs a baseline view count that predates OMI, and a source tag so
-- imported rows are distinguishable from ones recorded in-app. The share id is
-- the existing public_token — an import can set it to the original Loom id so
-- the /share/<id> URL matches the old Loom link. See
-- docs/omi/loom-replacement-plan.md.

ALTER TABLE recordings ADD COLUMN IF NOT EXISTS imported_views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'recorder'; -- 'recorder' | 'loom_import'
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS source_url TEXT;                          -- original Loom share URL, if imported
