-- Unify wp_pairing_tokens + shopify_pairing_tokens into one generic table.
-- Both were created in 066/067 with identical shape; the only difference is
-- which surface (WordPress plugin vs Shopify app) the token pairs. A single
-- table with a `surface` discriminator removes the duplication and gives one
-- place for token logic. Tokens are single-use and short-lived, so the live
-- data migrated here is minimal — but we copy before dropping so nothing is
-- lost. The whole migration runs in the runner's transaction (atomic).

CREATE TABLE IF NOT EXISTS pairing_tokens (
  token       TEXT PRIMARY KEY,
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  surface     TEXT NOT NULL CHECK (surface IN ('wordpress', 'shopify')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ,
  used_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pairing_tokens_client ON pairing_tokens(client_id);

-- Carry across any existing tokens, tagged with their surface.
INSERT INTO pairing_tokens (token, client_id, surface, created_at, expires_at, used_at)
  SELECT token, client_id, 'wordpress', created_at, expires_at, used_at FROM wp_pairing_tokens
  ON CONFLICT (token) DO NOTHING;
INSERT INTO pairing_tokens (token, client_id, surface, created_at, expires_at, used_at)
  SELECT token, client_id, 'shopify', created_at, expires_at, used_at FROM shopify_pairing_tokens
  ON CONFLICT (token) DO NOTHING;

DROP TABLE wp_pairing_tokens;
DROP TABLE shopify_pairing_tokens;
