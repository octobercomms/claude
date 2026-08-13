-- In-OMI screen recorder (internal Loom replacement). Staff record a screen/cam
-- walkthrough in the browser, it's stored (Cloudflare R2 in prod, local disk in
-- dev), and shared via an unguessable public_token link with per-view analytics.
-- See docs/omi/loom-replacement-plan.md. Routes: routes/recordings.js.

CREATE TABLE IF NOT EXISTS recordings (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  -- A recording can be about a specific client, or general (NULL).
  client_id     UUID REFERENCES clients(id) ON DELETE SET NULL,
  title         TEXT NOT NULL DEFAULT 'Untitled recording',
  storage_key   TEXT,                              -- object key in the media store
  mime          TEXT NOT NULL DEFAULT 'video/webm',
  duration_s    INTEGER,
  size_bytes    BIGINT,
  transcript    TEXT,                              -- filled by the Whisper worker (async)
  public_token  TEXT NOT NULL UNIQUE,              -- unguessable share-link token
  status        TEXT NOT NULL DEFAULT 'uploading', -- 'uploading' | 'ready' | 'failed'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recordings_owner
  ON recordings (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_client
  ON recordings (client_id, created_at DESC);

-- One row per view / progress ping — answers "did they watch it, and how much".
-- ip is stored hashed, never raw.
CREATE TABLE IF NOT EXISTS recording_views (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recording_id   UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  viewed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  watch_seconds  INTEGER NOT NULL DEFAULT 0,
  ip_hash        TEXT,
  referrer       TEXT
);

CREATE INDEX IF NOT EXISTS idx_recording_views_rec
  ON recording_views (recording_id, viewed_at DESC);
