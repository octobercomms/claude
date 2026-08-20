-- Bid workspace: persistent per-tender files + a single org-level "October bid
-- profile" that every bid workspace reads (and can update), so the agent gets
-- sharper across all bids.

-- Files uploaded into a tender's workspace (RFP packs, past bids, capability
-- decks). Bytes live on disk under uploads/tenders/<notice_id>/; this row is the
-- metadata. Cascades away with the notice.
CREATE TABLE IF NOT EXISTS tender_bid_files (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  notice_id    UUID NOT NULL REFERENCES tender_notices(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,           -- original name shown in the UI
  stored_name  TEXT NOT NULL,           -- uuid.ext on disk
  mime         TEXT,
  size_bytes   BIGINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tender_bid_files_notice ON tender_bid_files (notice_id, created_at);

-- The October bid profile — one row (id = 1). Markdown the agent reads on every
-- bid and proposes updates to (what we do, sectors, past bids, wins/losses,
-- reusable boilerplate). Cross-bid memory lives here.
CREATE TABLE IF NOT EXISTS tender_org_profile (
  id          INT PRIMARY KEY DEFAULT 1,
  profile_md  TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tender_org_profile_singleton CHECK (id = 1)
);
INSERT INTO tender_org_profile (id, profile_md) VALUES (1,
'# October — bid profile

October Communications is a UK PR & communications consultancy specialising in
arts, culture, design, architecture, heritage and destination/tourism. Core
services: international media relations, thought leadership, press strategy and
strategic communications for cultural-sector clients.

## Sectors we win in
(arts, museums & galleries, design & architecture, heritage, festivals/biennales,
tourism & destination)

## Past bids & outcomes
(add each bid here as you go — buyer, what was asked, what we proposed, won/lost,
why — so future bids learn from it)

## Reusable boilerplate
(capability statements, standard references, team bios, case studies to reuse)
')
ON CONFLICT (id) DO NOTHING;
