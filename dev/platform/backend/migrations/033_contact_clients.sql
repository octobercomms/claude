-- Shared contacts: turn outreach_contacts into a workspace-wide library and
-- introduce outreach_contact_clients as the per-client membership row that
-- holds the previously-per-contact unsubscribe state.
--
-- The journalist record itself ("Jane Smith, fashion editor at Vogue, tagged
-- 'fashion-press'") is workspace-wide. Each client (LOLO, Universal, etc.)
-- attaches the journalist via a membership row, and unsubscribe / per-client
-- notes live there. A journalist removing themselves from one client's list
-- does not affect any other client.
--
-- contacts.client_id stays as a nullable provenance pointer ("originally
-- created by this client") so we can show provenance and so the existing
-- queries continue to function during the transition.

CREATE TABLE IF NOT EXISTS outreach_contact_clients (
  contact_id UUID NOT NULL REFERENCES outreach_contacts(id) ON DELETE CASCADE,
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  unsubscribed_at TIMESTAMPTZ,
  notes TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (contact_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_outreach_contact_clients_client
  ON outreach_contact_clients(client_id);

-- Backfill: every existing contact becomes a member of the client that owns
-- it today, carrying their per-contact unsubscribe timestamp / status into
-- the per-client row so nothing changes from the journalist's point of view.
INSERT INTO outreach_contact_clients (contact_id, client_id, unsubscribed_at, added_at)
SELECT c.id, c.client_id,
       CASE
         WHEN c.status = 'unsubscribed'
           THEN COALESCE(c.unsubscribed_at, c.updated_at, c.created_at)
         ELSE NULL
       END,
       c.created_at
  FROM outreach_contacts c
 WHERE c.client_id IS NOT NULL
ON CONFLICT (contact_id, client_id) DO NOTHING;

-- Drop the NOT NULL on contacts.client_id so library-only contacts (added
-- without picking a client first) become legal.
ALTER TABLE outreach_contacts
  ALTER COLUMN client_id DROP NOT NULL;
