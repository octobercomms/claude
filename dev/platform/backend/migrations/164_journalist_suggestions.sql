-- Journalist Discovery Scout — a review queue for NEW journalists the account
-- exec finds on the open web for a client's beats/sector. Nothing here is in
-- the media DB yet; approving a suggestion creates the media contact (kind
-- 'media'), attaches it to the client, and marks the row 'added'. Dismissing
-- parks it so the scout won't re-surface the same person.

CREATE TABLE IF NOT EXISTS pr_journalist_suggestions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  outlet TEXT,
  beat TEXT,
  email TEXT,
  why TEXT,                 -- one specific, true reason this journalist fits
  source_url TEXT,          -- the page the scout actually read (provenance)
  status TEXT NOT NULL DEFAULT 'new',   -- new | added | dismissed
  contact_id UUID REFERENCES outreach_contacts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pr_journo_sugg_client
  ON pr_journalist_suggestions(client_id, status);

-- Dedupe helper: one open suggestion per (client, lower(email)) and per
-- (client, lower(name), lower(outlet)) is enforced in the service, but a
-- case-insensitive email lookup index keeps that check cheap.
CREATE INDEX IF NOT EXISTS idx_pr_journo_sugg_email
  ON pr_journalist_suggestions(client_id, lower(email));
