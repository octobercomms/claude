-- MP4 / GIF exports for recordings. The browser records WebM; staff can export
-- a shareable H.264 MP4 (or a short GIF) rendered server-side with ffmpeg. The
-- rendered assets live in the media store under their own keys; we track the
-- keys + the most recent export's status here. Service: services/recordingExport.js.
ALTER TABLE recordings
  ADD COLUMN IF NOT EXISTS mp4_key       TEXT,
  ADD COLUMN IF NOT EXISTS gif_key       TEXT,
  ADD COLUMN IF NOT EXISTS export_status TEXT;   -- NULL | 'processing' | 'ready' | 'failed'
