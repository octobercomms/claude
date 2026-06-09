-- Per-client PR settings: the public coverage-portal token, plus report/alert
-- prefs (used by the reports phase). One row per client.

CREATE TABLE IF NOT EXISTS pr_client_settings (
  client_id       UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  portal_token    TEXT NOT NULL UNIQUE,
  alert_email     VARCHAR(200) NOT NULL DEFAULT '',
  report_cadence  VARCHAR(20) NOT NULL DEFAULT 'off',
  last_report_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_pr_client_settings_updated_at BEFORE UPDATE ON pr_client_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
