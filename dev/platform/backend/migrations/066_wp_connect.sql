-- Platform-side ingest for the October MI WordPress plugin.
--
-- The plugin flips the data direction: instead of the platform polling the
-- client's WooCommerce/WP REST API (which WAFs challenge), the WP site pushes
-- signed events to /api/wp-connect/*. This adds the storage + a new connector
-- type so the rest of the platform sees WP data the same shape it would from
-- REST polling.
--
-- NOTE: ALTER TYPE ... ADD VALUE runs inside the migration runner's
-- transaction. That is supported on PostgreSQL 12+ (the platform runs a
-- modern Postgres); the new value is only *used* by later migrations / runtime
-- inserts, never within this same transaction, so there's no in-txn caveat.
ALTER TYPE connector_type_enum ADD VALUE IF NOT EXISTS 'wordpress_plugin';

-- One-time pairing tokens. Generated in the OMI dashboard, handed to the
-- client, exchanged once by the plugin's /pair call for a client_id +
-- refresh_secret. Single use, time-limited.
CREATE TABLE IF NOT EXISTS wp_pairing_tokens (
  token       TEXT PRIMARY KEY,
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ,
  used_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_wp_pairing_tokens_client ON wp_pairing_tokens(client_id);

-- Raw inbound events from paired WordPress sites. Append-only; the
-- wordpress_plugin connector aggregates these on read for the report period.
CREATE TABLE IF NOT EXISTS wp_connect_events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}',
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  error_log    TEXT
);
CREATE INDEX IF NOT EXISTS idx_wp_connect_events_client ON wp_connect_events(client_id);
CREATE INDEX IF NOT EXISTS idx_wp_connect_events_type ON wp_connect_events(client_id, event_type);
CREATE INDEX IF NOT EXISTS idx_wp_connect_events_received ON wp_connect_events(client_id, received_at DESC);
