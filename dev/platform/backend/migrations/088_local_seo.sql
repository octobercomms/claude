-- Local SEO toolkit — five on-demand Claude tools that turn a competitor URL,
-- a service+city, or the client's own site into a local-SEO deliverable:
--   competition_gap  — competitor content-gap killer
--   schema_audit     — structured-data audit + JSON-LD generation
--   buyer_intent     — buyer-intent local keyword list
--   competitor_xray  — business-vs-competitor comparison
--   gbp_posts        — Google Business Profile post generator
--
-- Each run is one row: the input that produced it + the structured Claude
-- output, both JSONB so they stay queryable per client + tool and the history
-- list can re-open any past run without a re-run.

CREATE TABLE IF NOT EXISTS local_seo_runs (
  id          SERIAL PRIMARY KEY,
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tool        TEXT NOT NULL,
  title       TEXT,
  input_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_local_seo_runs_client_tool
  ON local_seo_runs (client_id, tool, created_at DESC);
