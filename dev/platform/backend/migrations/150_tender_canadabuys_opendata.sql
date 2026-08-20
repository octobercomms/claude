-- Point CanadaBuys at the official open-data CSV (the daily "open tender
-- notices" feed) instead of the old guessed RSS path. Free, official, no
-- scraper. The adapter (sources/canadabuys.js) parses the CSV and filters to
-- the niche — validated to surface Destination Canada's Media Relations & PR
-- Services notice.
UPDATE tender_sources
  SET config = '{"listUrl":"https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv","country":"Canada"}'::jsonb,
      enabled = true,
      last_status = NULL
  WHERE name = 'CanadaBuys';
