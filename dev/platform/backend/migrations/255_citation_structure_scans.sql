-- Citation structure scans — the shapes on a page that may correlate with
-- being cited by an answer engine.
--
-- `features` is stored flat and separately from `report` on purpose. The
-- report is for the screen; the features are for the question nobody has
-- answered yet: do FAQs, schema depth, heading hierarchy and tables actually
-- predict citation on architecture and design sites? The figures that
-- motivated this come from a vendor's own study of SaaS and fintech pages.
-- Joining these rows against ai_visibility_runs.citations over time is how we
-- find out whether any of it transfers, rather than taking it on trust.

CREATE TABLE IF NOT EXISTS citation_structure_scans (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id   UUID REFERENCES clients(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  score       INT  NOT NULL,
  grade       VARCHAR(2) NOT NULL,
  features    JSONB NOT NULL DEFAULT '{}'::jsonb,
  report      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The read the panel does: latest scan per URL for one client.
CREATE INDEX IF NOT EXISTS idx_css_client_url_created
  ON citation_structure_scans (client_id, url, created_at DESC);

-- The read the analysis will do: every scan for a client over a window.
CREATE INDEX IF NOT EXISTS idx_css_client_created
  ON citation_structure_scans (client_id, created_at DESC);
