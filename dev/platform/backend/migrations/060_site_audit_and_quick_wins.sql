-- Site audit + quick wins.
--
-- site_audits / site_audit_issues — record of a crawl + analysis. A run
-- crawls up to N pages on the client's domain, scoring technical issues
-- (broken links, meta gaps, H1 problems, alt-text gaps, slow responses,
-- thin content). Each issue gets a row so the AM can dismiss / mark-done
-- individually, and so the Pipeline → Find → 'From your own site' mode
-- can pull open issues as content opportunities.
--
-- Quick wins are derived from existing seo_keywords data at read time
-- (no new storage) — keywords ranked 11–20 are the "one good refresh
-- away from page 1" cohort. The dismiss list IS persisted so AMs can
-- skip ones they've already actioned without re-actioning.

CREATE TABLE IF NOT EXISTS site_audits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,                          -- crawled root (snapshot, in case client.domain changes)
  pages_crawled INT NOT NULL DEFAULT 0,
  pages_attempted INT NOT NULL DEFAULT 0,        -- could be > crawled if some failed
  status VARCHAR(20) NOT NULL DEFAULT 'running', -- running | complete | failed
  score INT,                                     -- 0–100, weighted summary
  summary_json JSONB,                            -- per-category counts: broken_links, missing_meta_title, etc
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_site_audits_client
  ON site_audits(client_id, started_at DESC);

-- Per-issue rows. category drives which Pipeline step to suggest:
--   thin_content     → Pipeline → Draft (refresh mode)
--   missing_meta_*   → manual checklist task (AM action)
--   broken_link      → manual checklist task
--   missing_h1       → manual checklist task
--   no_alt_text      → manual checklist task
--   slow_response    → flag for dev team
--   noindex_blocked  → flag for review
--   duplicate_meta   → manual checklist task
CREATE TABLE IF NOT EXISTS site_audit_issues (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  audit_id UUID NOT NULL REFERENCES site_audits(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  page_url TEXT NOT NULL,
  category VARCHAR(40) NOT NULL,
  severity VARCHAR(10) NOT NULL DEFAULT 'medium', -- low | medium | high
  detail TEXT,                                    -- e.g. "Title is 12 chars (recommended 30–60)"
  metadata JSONB,                                 -- arbitrary supplementary data
  status VARCHAR(20) NOT NULL DEFAULT 'open',     -- open | in_progress | done | dismissed
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_audit_issues_client_status
  ON site_audit_issues(client_id, status, severity);

CREATE INDEX IF NOT EXISTS idx_site_audit_issues_audit
  ON site_audit_issues(audit_id, category);

-- Quick wins dismiss list — keep keywords from re-appearing once the
-- AM has actioned (or chosen to ignore) them. The "wins" themselves
-- are computed from seo_keywords at read time.
CREATE TABLE IF NOT EXISTS quick_win_dismissed (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  keyword_id UUID NOT NULL REFERENCES seo_keywords(id) ON DELETE CASCADE,
  reason VARCHAR(20),                             -- actioned | not_relevant | other
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, keyword_id)
);

CREATE INDEX IF NOT EXISTS idx_quick_win_dismissed_client
  ON quick_win_dismissed(client_id);
