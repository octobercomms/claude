-- Microsoft Clarity → CRO. Stores a per-client Clarity Data Export API token
-- (encrypted) and the AI-prioritised CRO reports generated from the behaviour
-- signals it returns (rage clicks, dead clicks, excessive scroll, quick-backs,
-- scroll depth, errors). See services/clarity.js.

CREATE TABLE IF NOT EXISTS client_clarity (
  client_id        UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  token_encrypted  JSONB NOT NULL,            -- encrypt() output {iv, data, ...}
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clarity_cro_reports (
  id           SERIAL PRIMARY KEY,
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  summary      TEXT,
  signals      JSONB NOT NULL DEFAULT '[]'::jsonb,  -- the compacted Clarity metrics
  findings     JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{priority, url, issue, fix}]
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clarity_reports_client ON clarity_cro_reports (client_id, generated_at DESC);
