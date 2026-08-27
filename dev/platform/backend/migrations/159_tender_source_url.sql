-- Provenance for web-search notices: the actual page Claude read to find the
-- notice (a portal listing, an aggregator page, a search result). Distinct from
-- `url` (the official notice page): source_url answers "how did it find this?"
-- and is shown as a "how Claude found this" link when there's no verified
-- official link, instead of a generic web search.
ALTER TABLE tender_notices
  ADD COLUMN IF NOT EXISTS source_url TEXT;
