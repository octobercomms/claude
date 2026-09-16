-- "Why we rank" context on each rank check. When we check a keyword we already
-- pull the full SERP, so the organic results ranking ABOVE the client are free
-- to capture — no extra DataForSEO call. Store the top few per check so the
-- rankings UI can show "who's beating you" alongside the position, and so it's
-- available historically. Populated by routes/rankings.js → runRankChecks from
-- connectors/dataforseo.js → checkRank().
ALTER TABLE seo_rank_history
  ADD COLUMN IF NOT EXISTS competitors JSONB NOT NULL DEFAULT '[]'::jsonb;
