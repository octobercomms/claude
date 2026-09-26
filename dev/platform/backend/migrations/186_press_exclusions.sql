-- Press exclusions: keep specific journalists off a release, and off a
-- client's sends permanently.
--
-- The case: a client speaks to a journalist directly. Sending them the
-- release makes October look uncoordinated. Sometimes that is true for one
-- release, sometimes it is true forever for that client.
--
-- What already existed, and why this is additive rather than a fix:
-- outreach_contacts.bounced_at, outreach_contact_clients.unsubscribed_at and
-- outreach_campaign_contacts.stopped_at are all re-checked in the dispatch
-- gate (scheduler.js runOutreachSends), which cancels a queued send when the
-- state changed after queueing. That gate works. There was simply no way to
-- express "exclude this person", so there was nothing for it to enforce.
--
-- Two scopes, because the operator means different things:
--
--   * PERMANENT, per client — excluded_at on the membership row. The client
--     owns this relationship; never send to them for this client again. Other
--     clients are unaffected, which is the whole point of the membership row.
--
--   * THIS RELEASE ONLY — excluded_contacts on the release. A judgement call
--     about one story that must not leak into the contact's standing record.
--
-- Deliberately NOT a tag and NOT a status change. Both of those would alter
-- the journalist's shared library record, which is workspace-wide and shared
-- across every client. An exclusion is a statement about one relationship,
-- so it belongs on the relationship.

ALTER TABLE outreach_contact_clients
  ADD COLUMN IF NOT EXISTS excluded_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS excluded_reason TEXT;

COMMENT ON COLUMN outreach_contact_clients.excluded_at IS
  'Permanently excluded from this client''s sends. Enforced in the dispatch gate; clearing it resumes.';

-- Partial index: the enforcement queries only ever ask for excluded rows, and
-- the excluded set is a rounding error next to the membership table.
CREATE INDEX IF NOT EXISTS idx_outreach_contact_clients_excluded
  ON outreach_contact_clients(client_id, contact_id)
  WHERE excluded_at IS NOT NULL;

-- Per-release exclusions. Mirrors the existing selected_tags / extra_contacts
-- pair from migration 162, which already stores the chosen audience on the
-- release, so the full picture of "who was this release aimed at" stays in
-- one row.
ALTER TABLE outreach_press_releases
  ADD COLUMN IF NOT EXISTS excluded_contacts UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN outreach_press_releases.excluded_contacts IS
  'Contact ids held back from this release only. Enforced at queue time and again in the dispatch gate.';
