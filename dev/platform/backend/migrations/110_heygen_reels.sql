-- HeyGen reels — the AI video suite (Phase 1). Pick a HeyGen avatar / Digital
-- Twin + voice, type a script, and HeyGen renders a captioned vertical reel via
-- its API (async: we submit, store the heygen video id, then poll status). This
-- table is both the record and the poll queue.

CREATE TABLE IF NOT EXISTS heygen_reels (
  id               SERIAL PRIMARY KEY,
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title            TEXT,
  script           TEXT NOT NULL,
  avatar_id        TEXT NOT NULL,
  avatar_type      TEXT NOT NULL DEFAULT 'avatar',   -- avatar | talking_photo
  avatar_name      TEXT,
  voice_id         TEXT NOT NULL,
  caption          BOOLEAN NOT NULL DEFAULT TRUE,
  status           TEXT NOT NULL DEFAULT 'queued',   -- queued | processing | completed | failed
  heygen_video_id  TEXT,
  video_url        TEXT,
  duration_s       NUMERIC,
  error            TEXT,
  requested_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_heygen_reels_client ON heygen_reels (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_heygen_reels_poll ON heygen_reels (status) WHERE status = 'processing';

DROP TRIGGER IF EXISTS update_heygen_reels_updated_at ON heygen_reels;
CREATE TRIGGER update_heygen_reels_updated_at BEFORE UPDATE ON heygen_reels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
