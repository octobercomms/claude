-- The Authority numbers stop being typed.
--
-- `seo_manual_metrics` was built when all three figures were copied by hand
-- from Moz and Semrush once a month. Two of them no longer need to be:
--
--   referring_domains — DataForSEO has carried this since the Backlinks API
--     came off its subscription on 1 July 2026. `dfs_backlinks_summary` has
--     been filling every three days ever since, and Drift and the Dashboard
--     already read it. The monthly hand-typed figure was a staler copy of a
--     number sitting in the same database, shown further up the same page.
--   moz_da — fetched from the Moz API, one row per client per month.
--
-- `authority_score` (Semrush) is retired rather than dropped. It measures the
-- same thing as Moz DA from a different vendor, so collecting both is typing
-- two numbers that move together. The column stays so the existing trend is
-- still readable; nothing writes to it any more.
--
-- The table keeps its name. Renaming it would touch every reader for no gain,
-- and `notes` is still genuinely manual.

-- Where each number came from, so the page can say rather than imply. A value
-- with no source is one of the historical hand-typed rows.
ALTER TABLE seo_manual_metrics
  ADD COLUMN IF NOT EXISTS moz_da_source VARCHAR(20),              -- 'moz' | 'manual'
  ADD COLUMN IF NOT EXISTS referring_domains_source VARCHAR(20),   -- 'dataforseo' | 'manual'
  ADD COLUMN IF NOT EXISTS sources_filled_at TIMESTAMPTZ;

-- Everything that exists today was typed by a person. Saying so is the point:
-- without it the old rows would silently read as API-sourced the moment the
-- page starts showing provenance.
UPDATE seo_manual_metrics
   SET moz_da_source = 'manual'
 WHERE moz_da IS NOT NULL AND moz_da_source IS NULL;

UPDATE seo_manual_metrics
   SET referring_domains_source = 'manual'
 WHERE referring_domains IS NOT NULL AND referring_domains_source IS NULL;
