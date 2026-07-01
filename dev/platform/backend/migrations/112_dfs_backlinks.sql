-- Phase E1 — Backlinks raw data pull (per client, every 3 days).
--
-- DataForSEO's Backlinks API went pay-as-you-go for everyone on 1 July 2026
-- (see docs/omi/dataforseo-july-2026.md). This lands the storage for the
-- 3-day sweep: each cycle writes a fresh snapshot row-set stamped with a
-- shared captured_at, so later phases (E2 summary panel, E3 new/lost diff,
-- E4 press→backlink attribution) can trend over time and diff snapshots.
--
-- Three tables, one per DFS endpoint pulled per cycle:
--   summary            -> /backlinks/summary/live            (one row / cycle)
--   referring domains  -> /backlinks/referring_domains/live  (top ~1000 / cycle)
--   anchors            -> /backlinks/anchors/live            (top ~100 / cycle)

CREATE TABLE IF NOT EXISTS dfs_backlinks_summary (
  id                      SERIAL PRIMARY KEY,
  client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  captured_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  backlinks_total         BIGINT,
  referring_domains_total BIGINT,
  dofollow_ratio          NUMERIC,          -- 0..1, dofollow backlinks / total backlinks
  spam_score              INTEGER,          -- DFS backlinks_spam_score, 0..100
  rank                    INTEGER,          -- DFS domain rank, 0..1000
  raw                     JSONB,            -- full summary result for later mining
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dfs_bl_summary_client
  ON dfs_backlinks_summary (client_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS dfs_referring_domains (
  id               SERIAL PRIMARY KEY,
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  captured_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  domain           TEXT NOT NULL,
  rank             INTEGER,                 -- referring domain's DFS rank
  first_seen       TIMESTAMPTZ,             -- when DFS first saw a link from this domain
  last_seen        TIMESTAMPTZ,             -- last visited / lost date
  backlinks_count  INTEGER,                 -- links to us from this domain
  dofollow         BOOLEAN,                 -- domain has at least one dofollow link to us
  raw              JSONB,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- E3 diffs consecutive snapshots per client; this index serves both the
-- "latest snapshot" lookup and the per-domain join across cycles.
CREATE INDEX IF NOT EXISTS idx_dfs_ref_domains_client
  ON dfs_referring_domains (client_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_dfs_ref_domains_lookup
  ON dfs_referring_domains (client_id, domain, captured_at DESC);

CREATE TABLE IF NOT EXISTS dfs_anchors (
  id                      SERIAL PRIMARY KEY,
  client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  captured_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  anchor                  TEXT NOT NULL,
  backlinks_count         INTEGER,
  referring_domains_count INTEGER,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dfs_anchors_client
  ON dfs_anchors (client_id, captured_at DESC);
