-- Audit log for field-level changes to contacts. Used by the "Tidy
-- contacts with Claude" workflow so AMs can see exactly what changed,
-- who applied it, and why — and have a paper trail if a Claude
-- suggestion turns out to be wrong.
--
-- Each row is one field change to one contact. A multi-field tidy
-- (e.g. fixing capitalisation AND filling company) writes multiple
-- rows. `source` distinguishes Claude-driven edits from manual ones
-- so reports can split "AI did X / AM did Y".

CREATE TABLE IF NOT EXISTS outreach_contact_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES outreach_contacts(id) ON DELETE CASCADE,
  field VARCHAR(60) NOT NULL,
  before_value TEXT,
  after_value TEXT,
  source VARCHAR(40) NOT NULL,
  rationale TEXT,
  applied_by UUID REFERENCES users(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oca_contact ON outreach_contact_audit(contact_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_oca_source ON outreach_contact_audit(source, applied_at DESC);
