-- Enable the composition editor for all users, removing the per-user gate.
-- The editor replaces the wizard (MakeAReel) and the single-track editor.
UPDATE users SET composition_editor = true WHERE composition_editor IS NOT true OR composition_editor IS NULL;
