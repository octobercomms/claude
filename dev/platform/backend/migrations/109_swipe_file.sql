-- Swipe file — "reel to ideas". Paste a reel/video URL; the video worker
-- downloads it (yt-dlp) and transcribes it (Whisper), then the platform turns
-- the transcript into a Claude idea card and emails it back + saves it here.
-- This table doubles as the worker queue (status: queued → processing → done/failed).

CREATE TABLE IF NOT EXISTS swipe_items (
  id            SERIAL PRIMARY KEY,
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  platform      TEXT,                              -- instagram / tiktok / youtube / other
  title         TEXT,                              -- best-effort title from yt-dlp
  status        TEXT NOT NULL DEFAULT 'queued',    -- queued / processing / done / failed
  transcript    TEXT,
  idea_card     JSONB,                             -- { hook, summary, why_it_works, angles[], format, tags[] }
  notes         TEXT,                              -- the AM's own note
  tags          TEXT[] DEFAULT '{}',
  email_to      TEXT,                              -- where the result is emailed (nullable → no email)
  emailed_at    TIMESTAMPTZ,
  error         TEXT,
  requested_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  claimed_by    TEXT,
  claimed_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_swipe_items_client ON swipe_items (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_swipe_items_queue ON swipe_items (status, created_at) WHERE status = 'queued';

DROP TRIGGER IF EXISTS update_swipe_items_updated_at ON swipe_items;
CREATE TRIGGER update_swipe_items_updated_at BEFORE UPDATE ON swipe_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
