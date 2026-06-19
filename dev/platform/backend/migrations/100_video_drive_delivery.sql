-- Video Studio: Google Drive delivery. A per-client target folder for finished
-- masters, and the Drive link a delivered project landed at. When a project's
-- output_target = 'drive', the export step uploads the master to the client's
-- folder. See services/socialDrive.uploadFile + videoProjects.deliverVideo.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS video_drive_folder TEXT;
ALTER TABLE video_projects ADD COLUMN IF NOT EXISTS delivered_url TEXT;
