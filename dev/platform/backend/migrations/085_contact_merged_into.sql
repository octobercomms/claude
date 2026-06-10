-- Contact dedup support. Mirrors pr_outlets.merged_into so we can soft-delete
-- duplicate contacts (preserves history; foreign keys keep working) instead of
-- hard-deleting them and losing their audit / engagement / coverage repointing
-- trail. A scan groups contacts by email + (normalised name + outlet); a merge
-- picks a canonical, repoints every reference (pr_editorial_log.contact_id,
-- outreach_contact_clients, outreach_contact_audit, …) and sets merged_into on
-- the losers. Reads filter out merged_into IS NOT NULL.

ALTER TABLE outreach_contacts
  ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES outreach_contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS outreach_contacts_merged_into_idx ON outreach_contacts (merged_into) WHERE merged_into IS NOT NULL;
