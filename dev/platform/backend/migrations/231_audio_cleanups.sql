-- AI audio cleanup via ElevenLabs Audio Isolation. Staff upload a recording
-- in Produce > Audio; the API strips echo, background noise and room reverb
-- while keeping speech natural. Both original and cleaned files live in the
-- media store. Service: services/audioIsolation.js. Routes: routes/audio.js.

CREATE TABLE IF NOT EXISTS audio_cleanups (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  client_id     UUID REFERENCES clients(id) ON DELETE SET NULL,
  title         TEXT NOT NULL DEFAULT 'Untitled',
  storage_key   TEXT,                                  -- original audio in the media store
  cleaned_key   TEXT,                                  -- cleaned audio in the media store
  mime          TEXT,
  size_bytes    BIGINT,
  cleaned_size  BIGINT,
  status        TEXT NOT NULL DEFAULT 'processing',    -- 'processing' | 'ready' | 'error'
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audio_cleanups_client
  ON audio_cleanups (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audio_cleanups_owner
  ON audio_cleanups (created_by, created_at DESC);
