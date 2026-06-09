-- Saved coverage-monitor searches per client (Serper Google News + Google
-- Alerts RSS). Hits land in pr_editorial_log as status='new' for review.

CREATE TABLE IF NOT EXISTS pr_coverage_searches (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  query        VARCHAR(500) NOT NULL DEFAULT '',
  sources      VARCHAR(100) NOT NULL DEFAULT 'serper',
  alerts_rss   VARCHAR(1000) NOT NULL DEFAULT '',
  cadence      VARCHAR(20) NOT NULL DEFAULT 'daily',
  status       VARCHAR(20) NOT NULL DEFAULT 'active',
  last_run_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pr_coverage_searches_client_idx ON pr_coverage_searches (client_id);

CREATE TRIGGER update_pr_coverage_searches_updated_at BEFORE UPDATE ON pr_coverage_searches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
