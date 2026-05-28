-- Brand Assets + Ad Creative
--
-- brand_assets:        per-client storage of logos, fonts, palette, product
--                      photography and free-form guideline notes. Used as
--                      reference input by the Social and Ad Creative
--                      generators so output looks on-brand rather than AI-
--                      generic.
--
-- ad_creative_batches: one row per "generate ad variations" call on the
--                      Paid page. Carries the brief + which assets +
--                      campaign context were used.
--
-- ad_creatives:        one row per concept Claude proposes within a batch.
--                      Each concept has its own headline / body / CTA /
--                      visual direction.
--
-- ad_creative_images:  per-concept rendered image at a specific aspect
--                      ratio. One concept usually has several (1:1, 4:5,
--                      9:16, 16:9) so it can be rolled out across
--                      placements from a single source idea.

CREATE TABLE IF NOT EXISTS brand_assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind VARCHAR(20) NOT NULL,        -- logo | product_image | palette | font | guideline
  name VARCHAR(255) NOT NULL,
  url TEXT,                          -- local /uploads path or external URL
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brand_assets_client_id ON brand_assets(client_id, kind);

CREATE TABLE IF NOT EXISTS ad_creative_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  brief TEXT,
  platform VARCHAR(20) NOT NULL DEFAULT 'meta',   -- meta | google | tiktok | linkedin
  asset_ids UUID[] NOT NULL DEFAULT '{}',
  campaign_context JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ad_creative_batches_client_id ON ad_creative_batches(client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ad_creatives (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID NOT NULL REFERENCES ad_creative_batches(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL DEFAULT 0,
  angle VARCHAR(80),                 -- "Problem/Solution" | "Social Proof" | "FOMO" | etc.
  headline TEXT,
  body TEXT,
  cta VARCHAR(80),
  visual_concept TEXT,
  framework VARCHAR(80),             -- AIDA | PAS | etc.
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ad_creatives_batch_id ON ad_creatives(batch_id);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_client_id ON ad_creatives(client_id, created_at DESC);

CREATE TRIGGER update_ad_creatives_updated_at BEFORE UPDATE ON ad_creatives
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS ad_creative_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creative_id UUID NOT NULL REFERENCES ad_creatives(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL,    -- replicate | ideogram
  aspect_ratio VARCHAR(10) NOT NULL,
  url TEXT NOT NULL,
  prompt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ad_creative_images_creative_id ON ad_creative_images(creative_id);
