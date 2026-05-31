-- Monthly search volume per keyword, populated from DataForSEO.
ALTER TABLE seo_keywords ADD COLUMN IF NOT EXISTS search_volume INTEGER;
