-- The web-search source now runs one focused pass PER market (portal-targeted,
-- chasing small/below-threshold notices), so maxSearches is a per-market budget.
-- Re-set it to sane per-market values (was 8, which is now ×4 markets = 32
-- searches/scan). 5 searches × 4 markets = up to 20 web searches per daily scan.
UPDATE tender_sources
  SET config = jsonb_set(jsonb_set(config, '{maxSearches}', '5'), '{maxResults}', '20'),
      last_status = NULL
  WHERE name = 'Web search (Claude)';
