-- Contacts intelligence phase 6: stale-contact archive/refresh. People move on
-- and retire; this lets the overnight sweep flag/auto-archive contacts with no
-- recent byline. `availability_status` already holds active/archived (reversible);
-- these columns track when we last web-checked a contact and whether the sweep
-- suggested archiving them (the ambiguous cases that want a human glance).

ALTER TABLE outreach_contacts
  ADD COLUMN IF NOT EXISTS last_byline_check TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archive_suggested BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS outreach_contacts_archive_suggested_idx ON outreach_contacts (archive_suggested) WHERE archive_suggested;
