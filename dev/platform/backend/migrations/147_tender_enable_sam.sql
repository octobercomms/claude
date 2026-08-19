-- Enable SAM.gov (US) — a SAM_API_KEY is now available (set via Settings, which
-- writes it to platform_settings and process.env). The adapter no-ops safely if
-- the key is ever missing. Idempotent.
UPDATE tender_sources SET enabled = true WHERE name = 'SAM.gov (US)';
