-- Many-to-many between recordings and clients: a video can be attached to more
-- than one client (e.g. a walkthrough relevant to several), and moved between
-- them. recordings.client_id stays as a legacy/creation hint; this join table is
-- the source of truth for "which clients can see this video". Backfills existing
-- single-client rows. See docs/omi/loom-replacement-plan.md.

CREATE TABLE IF NOT EXISTS recording_clients (
  recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  attached_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (recording_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_recording_clients_client
  ON recording_clients (client_id);

-- Backfill from the existing single client_id.
INSERT INTO recording_clients (recording_id, client_id)
  SELECT id, client_id FROM recordings WHERE client_id IS NOT NULL
  ON CONFLICT DO NOTHING;
