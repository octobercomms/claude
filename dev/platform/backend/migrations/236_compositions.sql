-- Composition projects: the new multi-track editor's persistence.
-- Each row is one composition belonging to one client.
-- The composition JSON lives in `data` (the same shape as shared/composition.mjs).
-- source_assets maps sourceId -> asset row id so the render can find files on disk.
CREATE TABLE IF NOT EXISTS compositions (
  id            SERIAL PRIMARY KEY,
  client_id     INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title         TEXT NOT NULL DEFAULT 'Untitled',
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_assets JSONB NOT NULL DEFAULT '{}'::jsonb,
  transcripts   JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'draft',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compositions_client ON compositions(client_id);
