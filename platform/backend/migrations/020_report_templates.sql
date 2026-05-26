-- Per-client report blueprint, designed conversationally with Claude and
-- locked in by the account manager. Replaces the checkbox + per-section
-- instruction model on the Reports tab, which couldn't express things like
-- "sum revenue across all B2C stores, then list individual store rows".
--
-- Shape:
-- {
--   "weekly":  { "version": 1, "sections": [ … ] },
--   "monthly": { "version": 1, "sections": [ … ] }
-- }
--
-- Section types: narrative | metrics_grid | connector_table | bar_chart |
-- position_distribution. See services/reportTemplate.js for the full schema
-- and the default generator used when this column is NULL for a client.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS report_templates JSONB DEFAULT NULL;
