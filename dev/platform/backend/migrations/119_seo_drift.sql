-- Integration E — SEO drift baselining ("Git for SEO").
--
-- A baseline is a point-in-time snapshot of the SEO signals OMI already
-- computes (rankings, latest site-audit score/issues, backlinks summary,
-- manual authority metrics). The AM captures one before a risky change (a
-- migration, a redesign, a big content push); later, compareToBaseline diffs
-- the current signals against it and severity-codes every regression.
-- Methodology mined (MIT) from claude-seo + seranking/seo-skills — see
-- docs/omi/seo-skills-integration-plan.md, Integration E.

CREATE TABLE IF NOT EXISTS seo_drift_baselines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  label TEXT,                                     -- optional AM name, e.g. "Pre-migration"
  snapshot JSONB NOT NULL,                        -- { rankings, site_audit, backlinks, authority }
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seo_drift_client
  ON seo_drift_baselines(client_id, captured_at DESC);
