-- Tidy-with-Claude runs as a background job, polled by the frontend.
-- Prior to this, the modal sent a synchronous POST that capped at 500
-- contacts because anything larger hit the 60s proxy timeout mid-batch.
-- With a job row the server can chew through the whole filter (17k+
-- contacts) over several minutes; the AM closes the tab if they want and
-- re-opens to find the result waiting.
--
-- Status lifecycle: 'running' → 'done' | 'failed'.
-- suggestions is populated incrementally as each batch finishes, so the
-- UI can stream a counter even before the run completes.

CREATE TABLE IF NOT EXISTS contact_tidy_runs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  filter_body   JSONB NOT NULL DEFAULT '{}',
  total         INT NOT NULL DEFAULT 0,
  processed     INT NOT NULL DEFAULT 0,
  suggestions   JSONB NOT NULL DEFAULT '[]',
  status        VARCHAR(20) NOT NULL DEFAULT 'running',
  error         TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS contact_tidy_runs_user_idx ON contact_tidy_runs (user_id, started_at DESC);
