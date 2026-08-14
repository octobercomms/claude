-- Client-facing reframe of a Strategist briefing. The internal briefing is
-- written for the account lead (blunt, commercial); the client report is a
-- second Claude pass that rewrites it as a polished progress report the client
-- can read. Cached here so repeat downloads are instant and don't re-bill a
-- Claude call — regenerated on demand with ?refresh=1.
ALTER TABLE strategist_briefings ADD COLUMN IF NOT EXISTS client_report TEXT;
ALTER TABLE strategist_briefings ADD COLUMN IF NOT EXISTS client_report_at TIMESTAMPTZ;
