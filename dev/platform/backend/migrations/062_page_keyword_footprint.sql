-- Per-page keyword footprint — recurring n-grams (1–3 token phrases)
-- extracted from each crawled page's visible text. Lets the AM see what
-- their site is ACTUALLY about per Google's eyes vs what they think it's
-- about. Flags pages with no clear keyword focus (low max frequency).
--
-- Populated piggyback on site_audits — every page the audit crawls
-- gets its top N phrases written here in the same run. No separate cron
-- because the data only changes when the page does, and that's what
-- triggers a fresh audit anyway.

CREATE TABLE IF NOT EXISTS site_audit_page_keywords (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  audit_id UUID NOT NULL REFERENCES site_audits(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  page_url TEXT NOT NULL,
  phrase TEXT NOT NULL,                    -- lowercased
  frequency INT NOT NULL,                  -- raw count in the page body
  rank INT NOT NULL,                       -- 1-based per page (1 = most frequent)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_page_keywords_audit
  ON site_audit_page_keywords(audit_id, page_url, rank);

CREATE INDEX IF NOT EXISTS idx_page_keywords_client_phrase
  ON site_audit_page_keywords(client_id, phrase);
