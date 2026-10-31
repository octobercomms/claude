-- The client's competitors, as records rather than a bare list of hostnames.
--
-- Two things made this necessary.
--
-- First, the same answer was being bought twice. Quick Start asks Claude for
-- competitors and keeps only `clients.competitor_domains` — the hostnames —
-- throwing away the brand name and the one-line reason it paid for. The Paid
-- → Competitors panel then calls the same service again on its own endpoint,
-- a second Claude call producing a second list that can disagree with the
-- first. Two prompts, two bills, two answers, one question.
--
-- Second, nothing survived a navigation. The panel held its suggestions in
-- component state, so leaving the screen lost them. Daniel: "The table should
-- remain when i click away and come back."
--
-- On the relationship with clients.competitor_domains: that column stays
-- authoritative and untouched in shape, because seven services read it (local
-- SEO x4, ICP, backlink prospecting, the strategist briefing and suite
-- progress). Rewriting all of those to read this table would be a far larger
-- change than the one being asked for. So this table is the richer record and
-- the column is a mirror of it, rewritten from here on every write. One
-- writer, one direction, so the two cannot drift.

CREATE TABLE IF NOT EXISTS client_competitors (
  id          SERIAL PRIMARY KEY,
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  -- Nullable: Claude sometimes names a brand it cannot place a domain on, and
  -- a competitor you know by name is still worth keeping. Rows without one
  -- simply cannot be pulled until someone fills it in.
  domain      TEXT,
  reason      TEXT,
  -- The Ads Transparency region this competitor is pulled in. Per row, not
  -- per panel: a UK client's competitors are not all advertising in the UK,
  -- and the old single select at the top of the page made you change it,
  -- remember to change it back, and get it wrong.
  region      TEXT NOT NULL DEFAULT 'GB',
  -- 'quickstart', 'suggest' or 'manual'. Kept so the panel can say where a
  -- row came from, and so a future cleanup can tell a human's entry from a
  -- model's guess.
  source      TEXT NOT NULL DEFAULT 'manual',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_competitors_client
  ON client_competitors (client_id, created_at);

-- One row per domain per client. Partial, because domain is nullable and
-- several name-only rows must be allowed to coexist.
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_competitors_domain
  ON client_competitors (client_id, lower(domain)) WHERE domain IS NOT NULL;

-- Seed from what is already stored, so no client arrives at the new panel
-- with an empty table and a reason to spend another Claude call. The name is
-- the domain until something better is known; the reason is genuinely not
-- known for these, and inventing one would be worse than leaving it null.
INSERT INTO client_competitors (client_id, name, domain, source)
SELECT c.id, d, lower(d), 'quickstart'
  FROM clients c, LATERAL unnest(COALESCE(c.competitor_domains, '{}')) AS d
 WHERE d IS NOT NULL AND btrim(d) <> ''
ON CONFLICT DO NOTHING;

-- A competitor Claude names but cannot place a domain on has no domain to
-- dedupe against, so the index above does not cover it and pressing "suggest
-- more" repeatedly piled up a fresh copy of the same brand each time. Names
-- are deduped per client too, for exactly the rows the first index misses.
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_competitors_name
  ON client_competitors (client_id, lower(name)) WHERE domain IS NULL;
