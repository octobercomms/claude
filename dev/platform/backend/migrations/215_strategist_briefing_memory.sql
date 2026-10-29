-- Give the Strategist briefing a memory.
--
-- Migration 041 and 140 both said the next briefing would "grade follow-through"
-- and "ground recommendations in what was actually actioned vs ignored". Neither
-- wired it up, so every briefing re-derived the account from nothing: it could
-- not tell you an item had been open for three weeks, could not follow up on
-- something you fixed, and wrote the same paragraphs at the same length every
-- Monday. A weekly document that never varies is one you stop opening.
--
-- Three columns carry the thread between briefings:
--
--   first_raised_at  When this item first appeared, carried across every
--                    briefing that keeps it open. NOW() - first_raised_at is
--                    the age the UI shows, and the pressure that makes a stale
--                    item uncomfortable to look at.
--   carried_from     The recommendation in the previous briefing that this one
--                    continues. Null for a newly raised item. Gives a chain to
--                    walk if you ever want to ask when something first came up.
--   rationale        Why the item matters, kept apart from what to do about it,
--                    so the queue can read as a list of actions with the
--                    reasoning folded away behind each one.

ALTER TABLE strategist_briefing_recommendations
  ADD COLUMN IF NOT EXISTS first_raised_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS carried_from    UUID,
  ADD COLUMN IF NOT EXISTS rationale       TEXT;

-- Existing rows have no history, so their first_raised_at is their own
-- created_at rather than the migration's NOW(): a briefing generated last month
-- should not read as raised today.
UPDATE strategist_briefing_recommendations
   SET first_raised_at = created_at
 WHERE first_raised_at > created_at;

-- The carry-forward query is "open items on this client's most recent briefing",
-- which is a client-scoped lookup, not a briefing-scoped one.
CREATE INDEX IF NOT EXISTS idx_strat_brief_recs_open
  ON strategist_briefing_recommendations (client_id, done, first_raised_at)
  WHERE done = false;
