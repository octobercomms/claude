-- A page gets its own size.
--
-- A set was one size and every page in it that size, which matched how one
-- campaign's posts were built. It stopped matching the moment a campaign
-- arrived as six Photoshop files across two sizes: the post version and the
-- story version of the same creative, which belong together and could not be
-- in the same set. Splitting them into two sets is the same split with a
-- label on it.
--
-- NULL means "the size of the set", which is what every existing page is, so
-- nothing needs backfilling and a set's own width and height stay meaningful:
-- they are the size a new page is made at and what "resize this set" sets.
-- The API returns the effective size via COALESCE so nothing downstream has
-- to know which of the two it came from.

ALTER TABLE design_pages ADD COLUMN IF NOT EXISTS width  INT;
ALTER TABLE design_pages ADD COLUMN IF NOT EXISTS height INT;

-- The same bounds the API enforces, here as well because the API is not the
-- only thing that will ever write this table.
ALTER TABLE design_pages DROP CONSTRAINT IF EXISTS design_pages_size_sane;
ALTER TABLE design_pages ADD CONSTRAINT design_pages_size_sane CHECK (
  (width  IS NULL OR (width  BETWEEN 50 AND 8000)) AND
  (height IS NULL OR (height BETWEEN 50 AND 8000))
);
