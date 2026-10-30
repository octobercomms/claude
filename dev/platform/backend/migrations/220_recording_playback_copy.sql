-- A playback copy of every recording, so a browser is handed a file whose
-- length it can read and whose middle it can seek to from the front of the
-- file alone.
--
-- MediaRecorder writes a *fragmented* file: a short moov, then moof/mdat pairs,
-- with the random-access index at the very end. Measured against real Chromium
-- captures (not guessed from the spec):
--
--   recorder.mp4   ftyp moov@36(695) moof mdat moof mdat mfra@771348
--                  mvhd does carry a duration, so the length shows at once,
--                  but seeking needs a range request to the tail for the mfra.
--   recorder.webm  duration reads as N/A even with the whole file in hand.
--                  A player cannot show a length or seek at all.
--
-- A stream-copy remux fixes both. It re-encodes nothing, so it runs in seconds
-- and loses no quality: `-movflags +faststart` rewrites the MP4 as a
-- progressive file with real sample tables at the front, and `-cues_to_front 1`
-- puts the WebM's seek index at the front and gives it a duration.
--
-- The result lives under its own key so the original capture is never put at
-- risk by a bad remux, and it is the original that stays downloadable and
-- editable. `play_key` is what the public watch stream serves when it is set;
-- NULL means "serve the original", which is what every recording made before
-- this does until the backfill runs. Service: services/recordingRemux.js.
ALTER TABLE recordings
  ADD COLUMN IF NOT EXISTS play_key    TEXT,
  ADD COLUMN IF NOT EXISTS play_status TEXT;   -- NULL | 'processing' | 'ready' | 'failed'
