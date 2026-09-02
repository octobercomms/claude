-- Provenance for journalist suggestions. The Discovery Scout finds people on the
-- open web (source stays NULL / 'scout'); the RSS byline miner (Phase 3) finds
-- brand-new writers already publishing at outlets we track (source = 'rss'). The
-- UI badges the feed-discovered ones so the account exec knows where each came
-- from. A "sample" article link is stashed in source_url as with the scout.
ALTER TABLE pr_journalist_suggestions
  ADD COLUMN IF NOT EXISTS source TEXT;
