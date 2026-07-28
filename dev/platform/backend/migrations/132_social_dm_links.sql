-- DM autoresponder — tracked links (ported from the OpenReply feature set).
-- Every link the bot sends in a DM/private-reply is auto-shortened to a
-- /api/social/r/<code> redirect that counts clicks, so the AM can see which
-- offers actually get tapped. One tracked link per (client, destination) so the
-- same URL reuses its code and its running total.

CREATE TABLE IF NOT EXISTS social_dm_links (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  code            TEXT NOT NULL UNIQUE,
  destination     TEXT NOT NULL,
  label           TEXT,
  clicks          INTEGER NOT NULL DEFAULT 0,
  last_clicked_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_social_dm_links_client ON social_dm_links (client_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_social_dm_links_client_dest ON social_dm_links (client_id, destination);
