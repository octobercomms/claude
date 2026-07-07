-- Record which connector produced the cached postcode distribution
-- (shopify | woocommerce), so the UI can label the refresh action and
-- decide what to show without a second connectors query on every read.
ALTER TABLE audience_postcode_cache
  ADD COLUMN IF NOT EXISTS source VARCHAR(24);
