-- Video Studio — the auto-edit pipeline's data model (slice 1: platform side).
-- See docs/omi/video-autoedit-plan.md.
--
-- A project is one edit job: its raw clips, the chosen brand style preset, and
-- the pipeline state. The actual editing runs on a DEDICATED WORKER box that
-- drains `video_jobs` — this migration defines the job-queue contract the
-- worker will consume; the worker + ffmpeg/Remotion stages land next slice.

CREATE TABLE IF NOT EXISTS video_projects (
  id            SERIAL PRIMARY KEY,
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  -- draft → queued → processing → graded → done | failed
  status        TEXT NOT NULL DEFAULT 'draft',
  style_preset  TEXT,                 -- which brand caption/motion preset to apply
  output_target TEXT NOT NULL DEFAULT 'download',  -- download | drive | dropbox | social
  score         INTEGER,              -- last QA grade (0–100)
  output_url    TEXT,                 -- finished vertical master, once exported
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS video_clips (
  id           SERIAL PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,         -- original upload name
  stored_path  TEXT NOT NULL,         -- relative path under the clips dir
  mime         TEXT,
  size_bytes   BIGINT,
  duration_s   NUMERIC,               -- filled by the worker's ffprobe ingest
  width        INTEGER,
  height       INTEGER,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The worker queue. One row per pipeline stage per project. The worker polls
-- for status='queued', claims one (claimed_by/claimed_at), runs it, and writes
-- status='done'|'failed'. attempt supports the grade→re-edit loop's retries.
CREATE TABLE IF NOT EXISTS video_jobs (
  id           SERIAL PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
  stage        TEXT NOT NULL,         -- ingest | roughcut | caption | grade | export
  status       TEXT NOT NULL DEFAULT 'queued',  -- queued | claimed | running | done | failed
  attempt      INTEGER NOT NULL DEFAULT 0,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  claimed_by   TEXT,
  claimed_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_clips_project ON video_clips (project_id, position);
CREATE INDEX IF NOT EXISTS idx_video_projects_client ON video_projects (client_id, created_at DESC);
-- Worker poll: oldest queued job first.
CREATE INDEX IF NOT EXISTS idx_video_jobs_queue ON video_jobs (status, created_at);
