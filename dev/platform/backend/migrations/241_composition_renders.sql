CREATE TABLE IF NOT EXISTS composition_renders (
  id SERIAL PRIMARY KEY,
  composition_id INTEGER NOT NULL REFERENCES compositions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'rendering', 'done', 'failed')),
  progress INTEGER NOT NULL DEFAULT 0,
  output_path TEXT,
  output_url TEXT,
  error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comp_renders_comp ON composition_renders(composition_id);
CREATE INDEX IF NOT EXISTS idx_comp_renders_status ON composition_renders(status);
