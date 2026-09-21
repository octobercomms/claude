-- De-duplicate tracked SEO keywords, and stop dupes recurring.
--
-- seo_keywords never had a unique constraint, so the bulk import's
-- "ON CONFLICT DO NOTHING" never actually fired — every import re-inserted the
-- same keywords as fresh rows. This collapses the existing duplicates and adds
-- the unique index the import relies on.
--
-- Dedupe key: (client_id, lower(keyword), device, location_code). target_url is
-- deliberately NOT part of the key — the rank check for a keyword is identical
-- whatever page you're hoping ranks, so the same keyword+device+location twice
-- is a duplicate. Same keyword on desktop AND mobile, or in different
-- locations, stays as separate legitimate rows.
--
-- When collapsing a group we keep the row with the MOST rank history (tie-break:
-- oldest), so no meaningful history is lost; the CASCADE on seo_rank_history
-- removes only the losing duplicates' (shorter) history.

WITH ranked AS (
  SELECT k.id,
         ROW_NUMBER() OVER (
           PARTITION BY k.client_id, lower(k.keyword), k.device, k.location_code
           ORDER BY COALESCE(hc.cnt, 0) DESC, k.created_at ASC, k.id ASC
         ) AS rn
    FROM seo_keywords k
    LEFT JOIN (
      SELECT keyword_id, COUNT(*) AS cnt FROM seo_rank_history GROUP BY keyword_id
    ) hc ON hc.keyword_id = k.id
)
DELETE FROM seo_keywords WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_seo_keywords_client_kw_device_loc
  ON seo_keywords (client_id, lower(keyword), device, location_code);
