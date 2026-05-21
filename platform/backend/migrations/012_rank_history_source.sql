-- Distinguish legacy-imported rank data from live DataForSEO data.
ALTER TABLE seo_rank_history ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'dataforseo';

-- Everything tracked on or before the legacy export date predates live
-- DataForSEO tracking, so mark it as legacy.
UPDATE seo_rank_history SET source = 'legacy' WHERE checked_at <= DATE '2026-05-19';
