-- Lock for the new multi-track composition editor (step 4 of the video editor
-- rewrite). Off by default; turned on per user in Settings. The nav row and
-- route are hidden without it, and a direct URL without it lands on the current
-- editor. Same pattern as can_use_visualise.
ALTER TABLE users ADD COLUMN IF NOT EXISTS composition_editor BOOLEAN NOT NULL DEFAULT false;
