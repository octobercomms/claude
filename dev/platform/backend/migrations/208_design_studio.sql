-- Design studio — layered social posts, made in OMI instead of Canva/Express.
--
-- The shape comes from how the work is actually done: one project is a set of
-- posts for a campaign ("ADF AH&L 2026"), each page a variation at the same
-- size, built from a full-bleed photo, a few text layers and logo lockups on
-- top. So a project owns ordered pages, and a page owns a scene.
--
-- The scene is Fabric.js canvas JSON, stored whole rather than modelled as
-- rows. Two reasons: the editor is the only thing that reads it, and a
-- normalised layer table would have to track every property Fabric knows about
-- (clip paths, filters, shadows, per-character styles) and would break on its
-- next release. The cost of JSONB here is that the database cannot query
-- inside a design, which nothing needs to do.
--
-- Assets are NOT duplicated here: brand_assets already stores logos, images and
-- fonts per client, with upload, bulk upload and authenticated serving. A scene
-- references them by their existing URL.

CREATE TABLE IF NOT EXISTS design_projects (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id   UUID REFERENCES clients(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  -- Page size for the whole project. Instagram portrait by default, which is
  -- what the posts this was built for use.
  width       INT NOT NULL DEFAULT 1080,
  height      INT NOT NULL DEFAULT 1350,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_design_projects_client
  ON design_projects (client_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS design_pages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
  sort_order  INT NOT NULL DEFAULT 0,
  -- Fabric canvas JSON. Empty object is a blank page.
  scene       JSONB NOT NULL DEFAULT '{}',
  -- A small PNG data URL, written by the editor on save, so the page strip and
  -- the project list render without loading and rasterising every scene.
  thumbnail   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_design_pages_project
  ON design_pages (project_id, sort_order);

CREATE TRIGGER update_design_projects_updated_at BEFORE UPDATE ON design_projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_design_pages_updated_at BEFORE UPDATE ON design_pages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
