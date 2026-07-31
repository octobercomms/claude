-- AI Visibility alerts — surfaced when a client's share of voice in AI answers
-- drops week-on-week, or a competitor overtakes the brand. Written by the weekly
-- alert check (services/aiVisibilityAlerts.js), shown in the panel and emailed to
-- the AM. Acknowledged alerts stay for history but drop out of the live banner.

CREATE TABLE IF NOT EXISTS ai_visibility_alerts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,                     -- 'sov_drop' | 'competitor_overtake'
  severity        TEXT NOT NULL DEFAULT 'medium',    -- 'high' | 'medium'
  title           TEXT NOT NULL,
  detail          TEXT,
  data            JSONB,                             -- the numbers behind the alert
  acknowledged_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_viz_alerts_client
  ON ai_visibility_alerts (client_id, created_at DESC);

-- Fast lookup for the dedup check (unacknowledged, by kind, recent).
CREATE INDEX IF NOT EXISTS idx_ai_viz_alerts_open
  ON ai_visibility_alerts (client_id, kind, acknowledged_at, created_at DESC);
