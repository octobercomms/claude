-- Customer-list audiences for the Paid suite. Until now Audiences could
-- only be sourced from Shopify orders (postcode distribution). This adds
-- first-party CUSTOMER LISTS uploaded as CSV: each upload becomes an
-- audience_segment with source = 'customer_list', and the contacts are
-- stored here SHA-256 hashed so we can export a Meta Custom Audience CSV
-- without ever persisting raw PII (email / phone).
--
-- Hashes follow Meta's Custom Audience spec: email lower-cased + trimmed,
-- phone reduced to digits, each SHA-256 hex. A row may carry an email
-- hash, a phone hash, or both.

CREATE TABLE IF NOT EXISTS audience_customer_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  segment_id UUID NOT NULL REFERENCES audience_segments(id) ON DELETE CASCADE,
  email_hash CHAR(64),
  phone_hash CHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audience_contacts_segment
  ON audience_customer_contacts(segment_id);
