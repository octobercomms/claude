-- Add the Web-search discovery source. This is how a person (and the user's
-- scheduled Claude task) actually finds these: search the open web and read the
-- notice pages, rather than polling a threshold-filtered OCDS data feed. It's the
-- source that surfaces SMALL / below-threshold jobs (the £20k Venice Biennale PR
-- brief, the River Tweed brand project) that the API feeds miss, and the search
-- runs at Anthropic's end (the web_search tool) so it isn't subject to the portal
-- firewalls that block our direct fetches. Runs alongside the API feeds, not
-- instead of them.
INSERT INTO tender_sources (name, kind, market, endpoint, config, enabled) VALUES
  ('Web search (Claude)', 'search', 'global', 'anthropic:web_search',
     '{"markets":["United Kingdom","Canada","European Union","United States"],"maxResults":25,"maxSearches":8}'::jsonb, true)
ON CONFLICT (name) DO NOTHING;
