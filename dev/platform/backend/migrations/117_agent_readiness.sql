-- Persist Agent Readiness checks so the Owned › Optimise panel shows the last
-- result on reload instead of a blank tab. One row per run; the panel reads the
-- most recent for the client.
CREATE TABLE IF NOT EXISTS agent_readiness_runs (
  id         SERIAL PRIMARY KEY,
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  url        TEXT,
  score      INTEGER,
  grade      TEXT,
  report     JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_readiness_client
  ON agent_readiness_runs (client_id, created_at DESC);
