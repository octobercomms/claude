-- Contacts merge, phase 1 (additive, non-breaking).
--
-- Goal: one contacts system instead of two (press journalists in pr_contacts
-- vs. outreach prospects in outreach_contacts). outreach_contacts is the
-- canonical table going forward — it already carries the heavier infrastructure
-- (campaigns, sends, verification, bounce, per-client membership), so the
-- smaller pr_contacts graph migrates INTO it (phase 2) rather than the reverse.
--
-- This migration only ADDS the press/media fields outreach_contacts is missing,
-- plus a unified `kind`. Nothing is moved or repointed yet, so it's safe to ship
-- on its own. Existing rows default to kind='prospect'.
--
-- The unused press data (pr_contacts) is disposable, so phase 2 does a clean
-- repoint + fresh start rather than a dedupe/backfill — no provenance pointer
-- needed.

ALTER TABLE outreach_contacts
  ADD COLUMN IF NOT EXISTS kind                VARCHAR(20)  NOT NULL DEFAULT 'prospect', -- prospect | media | industry
  ADD COLUMN IF NOT EXISTS outlet_id           UUID REFERENCES pr_outlets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS beats               JSONB        NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS availability_status VARCHAR(30)  NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS available_from      DATE,
  ADD COLUMN IF NOT EXISTS photo_url           VARCHAR(500) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bio_link            VARCHAR(500) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_contacted      DATE;

CREATE INDEX IF NOT EXISTS outreach_contacts_kind_idx ON outreach_contacts (kind);
CREATE INDEX IF NOT EXISTS outreach_contacts_outlet_idx ON outreach_contacts (outlet_id);
CREATE INDEX IF NOT EXISTS outreach_contacts_lower_email_idx ON outreach_contacts (lower(email));
