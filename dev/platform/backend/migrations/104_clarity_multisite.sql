-- Multi-site Microsoft Clarity (mirrors the Shopify multi-store pattern).
-- A client can now connect several Clarity projects/sites, each with its own
-- label (e.g. Falcon Enamelware "DTC", "Trade"). Each client_clarity row is one
-- site; CRO reports are tied to the site they were scanned from.

-- client_clarity: was one-row-per-client (client_id PK). Move to many-per-client
-- with a surrogate id + a label, unique per (client_id, label).
ALTER TABLE client_clarity DROP CONSTRAINT IF EXISTS client_clarity_pkey;
ALTER TABLE client_clarity ADD COLUMN IF NOT EXISTS id SERIAL PRIMARY KEY;
ALTER TABLE client_clarity ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT 'Main site';
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_clarity_client_label ON client_clarity (client_id, label);
CREATE INDEX IF NOT EXISTS idx_client_clarity_client ON client_clarity (client_id);

-- clarity_cro_reports: which site each report belongs to.
ALTER TABLE clarity_cro_reports ADD COLUMN IF NOT EXISTS clarity_id INTEGER REFERENCES client_clarity(id) ON DELETE CASCADE;
ALTER TABLE clarity_cro_reports ADD COLUMN IF NOT EXISTS site_label TEXT;

-- Backfill existing reports onto the client's (currently sole) Clarity site.
UPDATE clarity_cro_reports r
SET clarity_id = c.id, site_label = c.label
FROM client_clarity c
WHERE r.client_id = c.client_id AND r.clarity_id IS NULL;
