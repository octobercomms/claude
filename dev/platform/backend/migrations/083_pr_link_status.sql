-- Track the live-ness of coverage story URLs so the AM can spot dead links and
-- update them. Publications restructure CMSes, paywalls move pieces behind
-- different slugs, magazines purge old archives — the editorial log silently
-- ages out. A weekly background check flags broken links so the AM can hunt
-- for the new URL or archive.org snapshot.
--
-- Status values:
--   'ok'         — final URL returned 2xx (after redirects)
--   'broken'     — 404, 410, or DNS/connection failure (high-confidence dead)
--   'uncertain'  — 403/406/429/5xx/timeout (anti-bot, transient, or rate limit
--                  — could be dead, could be the publication blocking us)
--   NULL         — never checked
--
-- link_final_url captures where the URL ended up after redirects, so a
-- publication moving https://x.com/old to https://x.com/new still reads as
-- 'ok' but the AM can see the canonical URL changed.

ALTER TABLE pr_editorial_log
  ADD COLUMN IF NOT EXISTS link_status      VARCHAR(20),
  ADD COLUMN IF NOT EXISTS link_status_code INT,
  ADD COLUMN IF NOT EXISTS link_checked_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS link_final_url   TEXT;
