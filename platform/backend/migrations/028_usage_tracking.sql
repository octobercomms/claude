-- Phase 5: API usage / cost tracking.
--
-- usage_snapshots holds one row per (provider, snapshot_at) so we can
-- chart spend over time and surface a current "this month" total per
-- provider on Settings. Most providers expose a balance or usage
-- endpoint via the credentials we already store; a daily cron polls
-- each and writes a snapshot.
--
-- Fields are intentionally generic — providers report wildly different
-- shapes (balance left, characters used, requests this month, etc.),
-- so we capture the canonical numbers in dedicated columns and stuff
-- the full response into `raw` for drilldowns.

CREATE TABLE IF NOT EXISTS usage_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider VARCHAR(40) NOT NULL,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  period_start DATE,
  period_end DATE,
  cost_this_period NUMERIC(12, 4),     -- monetary spend if the API reports it
  balance_remaining NUMERIC(12, 4),
  currency VARCHAR(8),
  units_used BIGINT,                   -- generic "things consumed" (chars, requests, etc.)
  units_limit BIGINT,
  unit_label VARCHAR(40),              -- e.g. "characters", "requests", "credits"
  status VARCHAR(20) NOT NULL DEFAULT 'ok',    -- ok | error | no_credentials
  error_message TEXT,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_snapshots_provider ON usage_snapshots(provider, snapshot_at DESC);
