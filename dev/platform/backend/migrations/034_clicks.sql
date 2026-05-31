-- Per-send click log. Every link rewritten by the sender ends up here
-- when the recipient clicks it. We deliberately don't dedupe per URL —
-- repeated clicks on the same link tell us "they kept coming back".
--
-- Linked by send_id (which already carries campaign + contact) so the
-- activity timeline endpoint can join through to the journalist.

CREATE TABLE IF NOT EXISTS outreach_clicks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  send_id UUID NOT NULL REFERENCES outreach_sends(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_agent TEXT,
  ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_outreach_clicks_send ON outreach_clicks(send_id);
CREATE INDEX IF NOT EXISTS idx_outreach_clicks_time ON outreach_clicks(clicked_at DESC);
