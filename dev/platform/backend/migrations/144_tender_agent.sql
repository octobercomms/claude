-- Tender Agent — Phase 1 (ingest). Public-sector tender notices pulled from
-- portal feeds, deduplicated and normalised into a decision-ready store.
-- Org-level: October bids for itself, so there is no client_id (a nullable
-- owner column can be added later if this ever goes multi-tenant).
-- See docs/platform/tender-agent/STACK.md for the full plan and build order.

-- Where notices come from. One row per feed/endpoint; `config` carries the
-- per-source detail (RSS paths, CPV codes, whether an API key is required).
CREATE TABLE IF NOT EXISTS tender_sources (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL,                       -- rss | api | scrape
  market         TEXT,                                -- uk | eu | canada | us
  endpoint       TEXT NOT NULL,                       -- base URL
  config         JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled        BOOLEAN NOT NULL DEFAULT true,
  last_polled_at TIMESTAMPTZ,
  last_status    TEXT,                                -- short "ok: 12 new" / "error: …"
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name)
);

-- One row per notice, upserted on (source_id, external_ref). content_hash over
-- title + description + closing date lets us tell a genuine amendment (re-score)
-- from an identical re-publish (skip). closing_at is a real timestamp or NULL;
-- a NULL with needs_manual_check = true means "deadline couldn't be parsed —
-- a human should look" rather than a silent guess.
CREATE TABLE IF NOT EXISTS tender_notices (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id          UUID REFERENCES tender_sources(id) ON DELETE SET NULL,
  external_ref       TEXT NOT NULL,                   -- OCID / notice number
  url                TEXT,
  title              TEXT,
  buyer_name         TEXT,
  buyer_country      TEXT,
  buyer_city         TEXT,
  cpv_codes          TEXT[] NOT NULL DEFAULT '{}',
  published_at       TIMESTAMPTZ,
  closing_at         TIMESTAMPTZ,
  value_min          NUMERIC,
  value_max          NUMERIC,
  currency           TEXT,
  description        TEXT,
  raw_payload        JSONB,
  content_hash       TEXT,
  needs_manual_check BOOLEAN NOT NULL DEFAULT false,
  first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, external_ref)
);
CREATE INDEX IF NOT EXISTS idx_tender_notices_closing ON tender_notices (closing_at);
CREATE INDEX IF NOT EXISTS idx_tender_notices_seen    ON tender_notices (first_seen_at DESC);

-- Seed the four markets. D3 Tenders aggregates all four UK portals (Contracts
-- Finder, Find a Tender, Public Contracts Scotland, Sell2Wales) and TED covers
-- the EU — both are live. CanadaBuys and SAM.gov (US) adapters exist but ship
-- disabled until validated against their live feeds on deploy; flip `enabled`
-- to turn them on. SAM.gov additionally needs a free SAM_API_KEY in the env.
INSERT INTO tender_sources (name, kind, market, endpoint, config, enabled) VALUES
  ('D3 Tenders (UK)', 'rss', 'uk',     'https://d3tenders.com',
     '{"rss":["/feeds/rss-79.xml","/feeds/rss-92.xml"],"ocds":"/contract/{OCID}.json"}'::jsonb, true),
  ('TED (EU)',        'api', 'eu',     'https://api.ted.europa.eu',
     '{"cpv":["79416000","79416100","79416200","79340000","92500000","92520000"]}'::jsonb, true),
  ('CanadaBuys',      'rss', 'canada', 'https://canadabuys.canada.ca',
     '{"rss":["/en/tender-notices/rss"]}'::jsonb, false),
  ('SAM.gov (US)',    'api', 'us',     'https://api.sam.gov',
     '{"requiresKey":"SAM_API_KEY","cpv":[]}'::jsonb, false)
ON CONFLICT (name) DO NOTHING;
