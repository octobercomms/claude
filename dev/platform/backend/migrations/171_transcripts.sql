-- Audio transcription with speaker separation (diarisation). Staff upload an
-- audio file in Produce → Transcribe; ElevenLabs Scribe returns a word-level
-- transcript tagged by speaker, which we group into turns. The AM then names
-- each detected voice before the final labelled transcript is produced.
-- Service: services/elevenScribe.js. Routes: routes/transcripts.js.

CREATE TABLE IF NOT EXISTS transcripts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  -- A transcript can be filed under a specific client, or general (NULL).
  client_id     UUID REFERENCES clients(id) ON DELETE SET NULL,
  title         TEXT NOT NULL DEFAULT 'Untitled transcript',
  storage_key   TEXT,                                  -- audio object key in the media store
  mime          TEXT,
  size_bytes    BIGINT,
  status        TEXT NOT NULL DEFAULT 'processing',    -- 'processing' | 'ready' | 'error'
  language      TEXT,                                  -- detected language code
  segments      JSONB NOT NULL DEFAULT '[]'::jsonb,    -- [{ speaker, start, end, text }] in order
  speaker_names JSONB NOT NULL DEFAULT '{}'::jsonb,    -- { "speaker_0": "Daniel", ... }
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcripts_client
  ON transcripts (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transcripts_owner
  ON transcripts (created_by, created_at DESC);
