-- Standing media-desk maintenance. Two small review queues that let the platform
-- keep the journalist database clean the way an account exec would — surfacing
-- work for a human to approve, never mutating the DB on its own.

-- 1) Moved-outlet review. The RSS miner spots a journalist we already know
--    publishing under a DIFFERENT outlet than the one on their record — a likely
--    job move. We queue it (never auto-apply): approving repoints their outlet_id.
CREATE TABLE IF NOT EXISTS pr_contact_moves (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES outreach_contacts(id) ON DELETE CASCADE,
  from_outlet_id UUID REFERENCES pr_outlets(id) ON DELETE SET NULL,
  to_outlet_id   UUID NOT NULL REFERENCES pr_outlets(id) ON DELETE CASCADE,
  article_title TEXT,
  article_url TEXT,
  status TEXT NOT NULL DEFAULT 'new',   -- new | applied | dismissed
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);
-- One open move suggestion per (contact, destination outlet). A partial unique
-- index so a later, different move can still be queued once this one is resolved.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_moves_open
  ON pr_contact_moves (contact_id, to_outlet_id) WHERE status = 'new';
CREATE INDEX IF NOT EXISTS idx_contact_moves_status ON pr_contact_moves (status);

-- 2) Dedupe "not duplicates" suppression. When the AM reviews a suggested
--    duplicate cluster and says "these are different people", we remember the
--    cluster so the weekly scan/digest stops re-surfacing it. Keyed by the
--    sorted member-id signature of the cluster.
CREATE TABLE IF NOT EXISTS pr_contact_dedup_dismissed (
  cluster_key TEXT PRIMARY KEY,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
