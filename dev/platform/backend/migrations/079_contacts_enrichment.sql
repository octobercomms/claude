-- Contacts intelligence phase 4: enrichment fields on the unified contacts
-- table. `beats` already exists; this adds the enriched interest topics, a
-- one-line "what they cover" note, a confidence (0–1), and when it was last
-- enriched (so the overnight job only re-does stale/new ones). All additive.

ALTER TABLE outreach_contacts
  ADD COLUMN IF NOT EXISTS topics          JSONB        NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS enrichment_note TEXT         NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS enrichment_conf NUMERIC(4,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS outreach_contacts_last_enriched_idx ON outreach_contacts (last_enriched_at);
