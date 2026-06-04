-- Audience Insights — the Outra-substitute. Fills the audience gap for
-- the Paid suite: we already have data + creatives, this lets us define
-- targetable audiences from first-party Shopify data and (later)
-- demographic overlays.
--
-- audience_segments — named, saved segment definitions per client. The
-- filters JSONB carries the criteria the segment matches:
--   { postcode_districts: ['SW3','EH1'], min_income: 50000, ... }
-- estimated_reach is a snapshot recomputed by the segment service so
-- the UI can show "≈ 12,400 households" without recomputing every
-- render.
--
-- audience_postcode_cache — caches the first-party postcode aggregation
-- per client. Computing it requires walking every Shopify order; the
-- cache means the UI loads instantly and the live aggregation only
-- runs when the AM hits Refresh (or daily via a cron).

CREATE TABLE IF NOT EXISTS audience_segments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  estimated_reach INT,
  source VARCHAR(40) NOT NULL DEFAULT 'manual',  -- 'manual' | 'first_party_top' | 'lookalike'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audience_segments_client ON audience_segments(client_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS audience_postcode_cache (
  client_id UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  -- Array of { postcode_district, order_count, customer_count, revenue }
  postcodes JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_orders INT NOT NULL DEFAULT 0,
  total_revenue NUMERIC(14, 2) NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
