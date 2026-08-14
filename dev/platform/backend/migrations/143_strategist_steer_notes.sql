-- Steer notes: the account lead's own thoughts that should inform the next
-- cross-PESO briefing. Typed directly, or promoted from a point in the
-- ask-the-strategist chat. briefing.generate() reads these and weights them.
CREATE TABLE IF NOT EXISTS strategist_steer_notes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'note',   -- note | chat
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_strategist_steer_client
  ON strategist_steer_notes (client_id, created_at DESC);
