-- The currency the postcode distribution's revenue is in.
--
-- Audience Insights sums `order.total` per postcode district over 12 months
-- and the panel printed those totals as `£{n}`. For a Shopify store billing in
-- USD that label was simply wrong, which is worse than no label: a wrong
-- symbol reads as a fact. 216 fixed the same bug on the client dashboard.
--
-- The distribution is cached for 24 hours, so the currency has to be cached
-- with it. Without this column a cache hit would come back unlabelled until
-- the next recompute, which is the failure 216 was written to stop.
--
-- Null means the store did not report one (an older cached row, or a Woo
-- install that returned no orders). The figure then shows unlabelled, and the
-- client's `reporting_currency` still overrides this at read time, so setting
-- it in Setup labels the panel without waiting for the cache to expire.

ALTER TABLE audience_postcode_cache
  ADD COLUMN IF NOT EXISTS currency TEXT;

-- ISO 4217 or nothing, same shape the clients table enforces: a symbol or a
-- blank string would reach the UI as a label.
ALTER TABLE audience_postcode_cache
  DROP CONSTRAINT IF EXISTS audience_postcode_cache_currency_iso;
ALTER TABLE audience_postcode_cache
  ADD CONSTRAINT audience_postcode_cache_currency_iso
  CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$');
