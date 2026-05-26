-- Per-client, per-section instructions for the report writer. Free-text hints
-- like "For Shopify focus on refunds and net revenue" that get piped into
-- Claude's prompt when the corresponding section is generated.
--
-- Shape: { ga4: "...", shopify: "...", google_ads: "...", seo: "..." }
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS section_instructions JSONB NOT NULL DEFAULT '{}'::jsonb;
