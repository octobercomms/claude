-- Platform-side ingest for the October MI Shopify app.
--
-- The public Shopify app verifies Shopify's own webhook HMAC, then forwards a
-- normalised envelope to /api/shopify-app/webhook (and the pairing handshake to
-- /api/shopify-app/install). This adds the storage + a new connector type so
-- Shopify-app stores report the same way as the existing custom-OAuth shopify
-- connector. Contract: docs/october-mi-shopify/API.md.
--
-- NOTE: ALTER TYPE ... ADD VALUE runs inside the migration runner's
-- transaction, which is supported on PostgreSQL 12+; the value is only used at
-- runtime, never within this same transaction.
ALTER TYPE connector_type_enum ADD VALUE IF NOT EXISTS 'shopify_app';

-- One-time pairing tokens for the Shopify app. Mirrors the WordPress plugin's
-- flow: generated in the dashboard, pasted into the embedded admin, exchanged
-- once at /api/shopify-app/install. (A future cleanup could unify this with the
-- WordPress plugin's token table into one generic pairing_tokens table.)
CREATE TABLE IF NOT EXISTS shopify_pairing_tokens (
  token       TEXT PRIMARY KEY,
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ,
  used_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_shopify_pairing_tokens_client ON shopify_pairing_tokens(client_id);

-- Forwarded Shopify webhook events. Append-only; the shopify_app connector
-- aggregates these on read for the report period.
CREATE TABLE IF NOT EXISTS shopify_app_events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id    UUID REFERENCES clients(id) ON DELETE CASCADE,
  shop_domain  TEXT NOT NULL,
  topic        TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}',
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  error_log    TEXT
);
CREATE INDEX IF NOT EXISTS idx_shopify_app_events_client ON shopify_app_events(client_id);
CREATE INDEX IF NOT EXISTS idx_shopify_app_events_shop ON shopify_app_events(shop_domain);
CREATE INDEX IF NOT EXISTS idx_shopify_app_events_topic ON shopify_app_events(client_id, topic);
CREATE INDEX IF NOT EXISTS idx_shopify_app_events_received ON shopify_app_events(client_id, received_at DESC);

-- GDPR compliance request audit (customers/data_request, customers/redact,
-- shop/redact) so fulfilment is traceable.
CREATE TABLE IF NOT EXISTS shopify_gdpr_requests (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shop_domain  TEXT NOT NULL,
  topic        TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}',
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  handled_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_shopify_gdpr_requests_shop ON shopify_gdpr_requests(shop_domain);
