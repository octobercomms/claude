-- Country on a journalist, and country exclusions on a release.
--
-- WHY A NEW COLUMN RATHER THAN FILTERING ON `location`
--
-- outreach_contacts.location is free text, written by the paste importer or a
-- CSV column. In practice it holds "London", "New York", "UK", "United Kingdom"
-- or nothing at all. Filtering a send on that would be the mistake the agent
-- guide already records: a query that looks like enforcement and is not. "UK"
-- never matches "United Kingdom", a city name matches no country, and a blank is
-- invisible — so an exclusion built on it would quietly let through exactly the
-- people it was meant to hold back.
--
-- So: a normalised `country`, plus `country_source` saying where the value came
-- from, because a country inferred from an email TLD deserves less trust than one
-- read off the outlet record, and the operator needs to be able to see which is
-- which before relying on a filter.
--
-- Nothing here calls an AI model. The backfill in services/contactCountry.js
-- derives from data already held (the outlet's country, the email TLD, the
-- location text). Enriching 20,000 contacts with a model is what cost £24 a week
-- in September; see docs/omi/ai-budgets.md.

ALTER TABLE outreach_contacts
  ADD COLUMN IF NOT EXISTS country        TEXT,
  -- outlet | location | tld | city | manual | import. Ranked best-first in
  -- services/contactCountry.js; a stronger source may overwrite a weaker one,
  -- and 'manual' is never overwritten by a derivation.
  ADD COLUMN IF NOT EXISTS country_source VARCHAR(20);

-- Partial: every query that cares is already scoped to media contacts.
CREATE INDEX IF NOT EXISTS idx_outreach_contacts_country
  ON outreach_contacts(country) WHERE kind = 'media';

-- Per-release country exclusions.
--
-- Unknown country is a first-class state, not a silent one. Excluding "United
-- States" must not quietly include thousands of contacts whose country we never
-- resolved, nor quietly drop them: the operator decides per release, and the
-- audience panel shows the unknown count so the decision is informed.
--   'send' (default) — only positively identified contacts in an excluded
--                      country are held back. Keeps reach.
--   'hold'           — anyone not positively identified as outside the excluded
--                      countries is held back too. Safer, costs reach.
ALTER TABLE outreach_press_releases
  ADD COLUMN IF NOT EXISTS excluded_countries     TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS unknown_country_policy VARCHAR(10) NOT NULL DEFAULT 'send';

ALTER TABLE outreach_press_releases
  DROP CONSTRAINT IF EXISTS outreach_press_releases_unknown_country_policy_check;
ALTER TABLE outreach_press_releases
  ADD CONSTRAINT outreach_press_releases_unknown_country_policy_check
  CHECK (unknown_country_policy IN ('send', 'hold'));
