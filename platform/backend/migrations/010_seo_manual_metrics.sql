CREATE TABLE seo_manual_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  month DATE NOT NULL, -- first day of month, e.g. 2026-05-01
  moz_da INTEGER,
  authority_score INTEGER,
  referring_domains INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, month)
);
CREATE INDEX idx_seo_manual_metrics_client ON seo_manual_metrics(client_id, month DESC);
