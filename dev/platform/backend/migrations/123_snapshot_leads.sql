-- Snapshot Studio — lead-gen for October itself. A prospect's URL (and later
-- their email) creates a snapshot_lead; the Studio drafts a personalised
-- "Growth Snapshot" from their site via Claude, the AM curates imagery + copy,
-- then generates + sends the PDF. Leads live here, NOT in the clients table, so
-- prospects never clutter real client work.

CREATE TABLE IF NOT EXISTS snapshot_leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  url TEXT NOT NULL,
  company_name TEXT,
  email TEXT,
  ig_handle TEXT,
  -- new → gathered/drafted → sent → booked → archived
  status VARCHAR(24) NOT NULL DEFAULT 'new',
  scores JSONB,          -- headline scores { search, ai, social, pr }
  draft JSONB,           -- the full drafted report (summary + sections)
  notes TEXT,
  source VARCHAR(24) NOT NULL DEFAULT 'manual',   -- manual | public
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email_requested_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_snapshot_leads_created ON snapshot_leads(created_at DESC);

CREATE TABLE IF NOT EXISTS snapshot_lead_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES snapshot_leads(id) ON DELETE CASCADE,
  url TEXT,                                   -- remote (their site) or stored filename
  kind VARCHAR(16) NOT NULL DEFAULT 'site',   -- site | upload | screenshot
  filename TEXT,                              -- set for uploaded files on disk
  featured BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_snapshot_lead_images_lead ON snapshot_lead_images(lead_id);
