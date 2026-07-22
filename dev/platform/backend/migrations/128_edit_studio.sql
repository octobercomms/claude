-- Edit studio — a guided, server-side video editor (the three jobs an AM
-- actually uses: trim, audio cleanup, auto-captions). One row per edit job; the
-- source and rendered outputs live on disk per client and are served through an
-- authed route (same pattern as Visualise / ad-resize). Doubles as the work
-- queue for the inline processor (status queued → processing → done/failed).

CREATE TABLE IF NOT EXISTS edit_jobs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  source_name TEXT,
  source_url  TEXT NOT NULL,
  source_meta JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { duration, width, height }
  ops         JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { trim:{start,end}, clean_audio, captions, caption_style }
  status      TEXT NOT NULL DEFAULT 'queued',       -- queued | processing | done | failed
  output_url  TEXT,
  srt_url     TEXT,
  cost_usd    NUMERIC(10,4) NOT NULL DEFAULT 0,
  error       TEXT,
  claimed_by  TEXT,
  claimed_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_edit_jobs_client ON edit_jobs (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edit_jobs_queued ON edit_jobs (created_at) WHERE status = 'queued';
