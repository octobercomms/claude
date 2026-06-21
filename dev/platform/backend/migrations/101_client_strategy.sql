-- Client strategy playbooks. A library of stage × business-type marketing
-- strategies (each a summary + a phased checklist). In Setup we capture the
-- client's business type + lifecycle stage and auto-assign the matching
-- template; the client dashboard shows the strategy and a checkable checklist
-- the AM works through. See services/strategyTemplates.js.

CREATE TABLE IF NOT EXISTS strategy_templates (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  business_type   TEXT NOT NULL,            -- retail | service | ecommerce | b2b | local | saas
  lifecycle_stage TEXT NOT NULL,            -- launch | growth | established | maturity
  summary         TEXT,
  phases          JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ title, items: ["..."] }]
  is_seed         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_strategy_templates_match ON strategy_templates (business_type, lifecycle_stage);

-- Per-client assigned strategy: a snapshot of the template's phases with the
-- AM's checkbox + note state, so editing a template later never wipes progress
-- and "Tailor with Claude" can adapt this copy without touching the library.
CREATE TABLE IF NOT EXISTS client_strategy (
  client_id    UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  template_id  INTEGER REFERENCES strategy_templates(id) ON DELETE SET NULL,
  summary      TEXT,
  phases       JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ title, items: [{ id, text, done, note }] }]
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE clients ADD COLUMN IF NOT EXISTS business_type   TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT;
