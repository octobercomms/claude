-- GTM Brain Phase 0: a dated snapshot of stale crucial items per client.
--
-- The GTM Brain's success metric is "stale crucial items trend down", which
-- requires knowing what the number was before the first change. This table
-- records it weekly (alongside the strategist briefing) so there is always
-- a baseline to measure improvement against.
--
-- Each row is one client on one date. The weekly job inserts one row per
-- active client; the dashboard reads them back as a time series.

CREATE TABLE IF NOT EXISTS gtm_baselines (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  snapshot_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  crucial_open    INTEGER NOT NULL DEFAULT 0,
  stale_count     INTEGER NOT NULL DEFAULT 0,
  oldest_item_days INTEGER,
  detail          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gtm_baselines_client_date
  ON gtm_baselines (client_id, snapshot_date);

CREATE INDEX IF NOT EXISTS idx_gtm_baselines_date
  ON gtm_baselines (snapshot_date DESC);
