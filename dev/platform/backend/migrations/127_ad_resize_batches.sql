-- Persist "Resize for ads" runs so they can be reopened and bulk-downloaded
-- later, instead of vanishing on refresh. One row per resize run (a batch of
-- one or many source images); the full result payload — every source image with
-- its sized outputs (served URLs, dims, method) — is kept in `result` jsonb so
-- the UI can re-render a past run without recomputing anything.

CREATE TABLE IF NOT EXISTS ad_resize_batches (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  source_count INT NOT NULL DEFAULT 0,
  size_count   INT NOT NULL DEFAULT 0,
  spend_usd    NUMERIC(10,4) NOT NULL DEFAULT 0,
  result       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ad_resize_batches_client
  ON ad_resize_batches (client_id, created_at DESC);
