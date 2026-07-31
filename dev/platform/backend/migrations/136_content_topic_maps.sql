-- Content topic maps — the persisted, living version of keyword clustering.
-- Instead of clustering an ad-hoc list and throwing it away, an AM builds a
-- topic map from a seed (Claude expands it into a keyword universe grounded in
-- the brief + the client's existing tracked keywords, then clusters it into
-- question-led pieces). Each cluster is one planned piece of content and carries
-- a status through the pipeline (planned → briefed → drafted → published), so
-- the map doubles as a content plan / editorial calendar.

CREATE TABLE IF NOT EXISTS content_topic_maps (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  seed       TEXT,                                  -- the theme the map was grown from
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_content_topic_maps_client
  ON content_topic_maps (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS content_topic_clusters (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  map_id           UUID NOT NULL REFERENCES content_topic_maps(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  label            TEXT NOT NULL,
  core_question    TEXT,
  primary_keyword  TEXT NOT NULL,
  secondary        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- the keyword series
  intent           TEXT DEFAULT 'informational',
  rationale        TEXT,
  status           TEXT NOT NULL DEFAULT 'planned',      -- planned | briefed | drafted | published | dismissed
  brief_json       JSONB,                                -- filled when a brief is generated for this cluster
  content_draft_id UUID REFERENCES content_drafts(id) ON DELETE SET NULL,
  position         INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_content_topic_clusters_map
  ON content_topic_clusters (map_id, position ASC);
CREATE INDEX IF NOT EXISTS idx_content_topic_clusters_client
  ON content_topic_clusters (client_id, status);
