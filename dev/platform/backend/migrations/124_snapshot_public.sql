-- Public Growth Snapshot front door (embed on octobercomms.com).
-- A visitor submits their URL (+ optional Instagram handle) on the embedded
-- widget; that creates a public snapshot_lead they can later attach an email
-- to. public_token is the browser-facing handle (so the widget never sees the
-- internal admin id, and the id can't be enumerated). public_ip is kept for
-- abuse review only.

ALTER TABLE snapshot_leads ADD COLUMN IF NOT EXISTS public_token TEXT;
ALTER TABLE snapshot_leads ADD COLUMN IF NOT EXISTS public_ip TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshot_leads_public_token
  ON snapshot_leads(public_token) WHERE public_token IS NOT NULL;
