-- Legacy SEO rank backfill — Falcon Enamelware
-- Source: position exports (UK + US), positions for 2026-05-18 and 2026-05-19.
-- Adds any legacy keyword not already tracked and backfills its rank history.
-- Idempotent: keywords use NOT EXISTS, history uses ON CONFLICT — safe to re-run.
--
-- Run on the server against the platform database, e.g.:
--   sudo -u postgres psql -d octoberplatform -f platform/backend/scripts/import-legacy-ranks.sql

BEGIN;

-- ===== United Kingdom (2826) — 2 date column(s) =====
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamel dinner set', 'https://www.falconenamelware.com/collections/dinnerware', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel dinner set' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 2, 'https://www.falconenamelware.com/collections/dinnerware' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel dinner set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 2, 'https://www.falconenamelware.com/collections/dinnerware' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel dinner set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamel dinnerware', 'https://www.falconenamelware.com/collections/dinnerware', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel dinnerware' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 1, 'https://www.falconenamelware.com/collections/dinnerware' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel dinnerware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 1, 'https://www.falconenamelware.com/collections/dinnerware' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel dinnerware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamel kitchenware', 'https://www.falconenamelware.com/collections/all', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel kitchenware' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 1, 'https://www.falconenamelware.com/collections/all' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel kitchenware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 1, 'https://www.falconenamelware.com/collections/all' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel kitchenware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamel mug', 'https://www.falconenamelware.com/products/enamel-mug', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel mug' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 1, 'https://www.falconenamelware.com/products/enamel-mug' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel mug' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 1, 'https://www.falconenamelware.com/products/enamel-mug' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel mug' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamel teapot', 'https://www.falconenamelware.com/pages/teapot', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel teapot' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 1, 'https://www.falconenamelware.com/pages/teapot' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel teapot' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 1, 'https://www.falconenamelware.com/pages/teapot' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel teapot' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamelware dishes', 'https://www.falconenamelware.com/collections/dinnerware', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamelware dishes' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 1, 'https://www.falconenamelware.com/collections/dinnerware' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamelware dishes' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 1, 'https://www.falconenamelware.com/collections/dinnerware' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamelware dishes' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamelware mug', 'https://www.falconenamelware.com/products/enamel-mug', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamelware mug' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 1, 'https://www.falconenamelware.com/products/enamel-mug' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamelware mug' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 1, 'https://www.falconenamelware.com/products/enamel-mug' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamelware mug' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamelware plates', 'https://www.falconenamelware.com/collections/dinnerware', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamelware plates' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 1, 'https://www.falconenamelware.com/collections/dinnerware' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamelware plates' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 1, 'https://www.falconenamelware.com/collections/dinnerware' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamelware plates' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'medium serving dish', 'https://www.falconenamelware.com/products/medium-salad-bowl', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='medium serving dish' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='medium serving dish' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='medium serving dish' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamel plates', 'https://www.falconenamelware.com/pages/plate-set', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel plates' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 2, 'https://www.falconenamelware.com/pages/plate-set' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel plates' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 2, 'https://www.falconenamelware.com/pages/plate-set' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel plates' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamelware', 'https://www.falconenamelware.com/', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamelware' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 1, 'https://www.falconenamelware.com/' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamelware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 1, 'https://www.falconenamelware.com/' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamelware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'medium salad bowl', 'https://www.falconenamelware.com/pages/salad-bowls-for-sharing', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='medium salad bowl' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 15, 'https://www.falconenamelware.com/pages/salad-bowls-for-sharing' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='medium salad bowl' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 12, 'https://www.falconenamelware.com/pages/salad-bowls-for-sharing' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='medium salad bowl' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamel pie dish', 'https://www.falconenamelware.com/pages/pie-dish', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel pie dish' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 1, 'https://www.falconenamelware.com/pages/pie-dish' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel pie dish' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 1, 'https://www.falconenamelware.com/pages/pie-dish' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel pie dish' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'large serving dish', 'https://us.falconenamelware.com/collections/all', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='large serving dish' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='large serving dish' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='large serving dish' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'large salad bowl', 'https://www.falconenamelware.com/products/large-salad-bowl', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='large salad bowl' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='large salad bowl' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='large salad bowl' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'serving dish set', 'https://us.falconenamelware.com/collections/all', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='serving dish set' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='serving dish set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='serving dish set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'roasting dishes', 'https://www.falconenamelware.com/pages/roasting-dishes', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='roasting dishes' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='roasting dishes' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='roasting dishes' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'individual pie dishes', 'https://www.falconenamelware.com/pages/individual-pie-dishes', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='individual pie dishes' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 2, 'https://www.falconenamelware.com/pages/individual-pie-dishes' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='individual pie dishes' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 2, 'https://www.falconenamelware.com/pages/individual-pie-dishes' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='individual pie dishes' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'baking set', 'https://www.falconenamelware.com/pages/baking-set', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='baking set' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='baking set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='baking set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'picnic plates', 'https://www.falconenamelware.com/pages/picnic-plates', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='picnic plates' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 21, 'https://www.falconenamelware.com/pages/picnic-plates' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='picnic plates' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 20, 'https://www.falconenamelware.com/pages/picnic-plates' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='picnic plates' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'teapot', 'https://www.falconenamelware.com/products/tea-pot', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='teapot' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='teapot' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='teapot' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamel cookware', 'https://www.falconenamelware.com/collections/all', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel cookware' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 3, 'https://www.falconenamelware.com/collections/all' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel cookware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 1, 'https://www.falconenamelware.com/collections/all' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel cookware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamel', 'https://www.falconenamelware.com/', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'serving plate', 'https://us.falconenamelware.com/collections/all', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='serving plate' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='serving plate' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='serving plate' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'picnic tableware', 'https://www.falconenamelware.com/pages/picnic-plates', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='picnic tableware' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 6, 'https://www.falconenamelware.com/pages/picnic-plates' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='picnic tableware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 11, 'https://www.falconenamelware.com/pages/picnic-plates' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='picnic tableware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'tumbler', 'https://www.falconenamelware.com/products/tumblers', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tumbler' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tumbler' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tumbler' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'baking pan set', 'https://www.falconenamelware.com/pages/baking-set', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='baking pan set' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 7, 'https://www.falconenamelware.com/pages/baking-set' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='baking pan set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 7, 'https://www.falconenamelware.com/pages/baking-set' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='baking pan set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'what is enamel', 'https://us.falconenamelware.com/blogs/journal/what-is-enamelware', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='what is enamel' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 11, 'https://us.falconenamelware.com/blogs/journal/what-is-enamelware' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='what is enamel' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 17, 'https://us.falconenamelware.com/blogs/journal/what-is-enamelware' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='what is enamel' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'picnic dinner set', 'https://www.falconenamelware.com/pages/picnic-plates', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='picnic dinner set' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 17, 'https://www.falconenamelware.com/pages/picnic-plates' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='picnic dinner set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 17, 'https://www.falconenamelware.com/pages/picnic-plates' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='picnic dinner set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'picnic plates set', 'https://www.falconenamelware.com/pages/picnic-plates', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='picnic plates set' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 5, 'https://www.falconenamelware.com/pages/picnic-plates' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='picnic plates set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 4, 'https://www.falconenamelware.com/pages/picnic-plates' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='picnic plates set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'pasta bowl set', 'https://www.falconenamelware.com/pages/pasta-bowl-set', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='pasta bowl set' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='pasta bowl set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='pasta bowl set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'serving dish', 'https://us.falconenamelware.com/collections/all', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='serving dish' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='serving dish' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='serving dish' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'outdoor dinner set', 'https://www.falconenamelware.com/pages/picnic-plates', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='outdoor dinner set' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='outdoor dinner set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='outdoor dinner set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'porcelain enamel cookware', 'https://www.falconenamelware.com/collections/kitchenware', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='porcelain enamel cookware' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 5, 'https://www.falconenamelware.com/collections/kitchenware' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='porcelain enamel cookware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 4, 'https://www.falconenamelware.com/collections/kitchenware' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='porcelain enamel cookware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'pie dish', 'https://www.falconenamelware.com/pages/pie-dish', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='pie dish' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 4, 'https://www.falconenamelware.com/pages/pie-dish' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='pie dish' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 2, 'https://www.falconenamelware.com/pages/pie-dish' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='pie dish' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'plate set', 'https://www.falconenamelware.com/pages/plate-set', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='plate set' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='plate set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='plate set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'pie tin', 'https://www.falconenamelware.com/products/30cm-coal-black-pie-dish', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='pie tin' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='pie tin' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='pie tin' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'camping dinner set', 'https://www.falconenamelware.com/collections/camping-essentials', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='camping dinner set' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='camping dinner set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='camping dinner set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'camping plates and bowls', 'https://www.falconenamelware.com/collections/camping-essentials', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='camping plates and bowls' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 31, 'https://www.falconenamelware.com/collections/camping-essentials' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='camping plates and bowls' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 30, 'https://www.falconenamelware.com/collections/camping-essentials' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='camping plates and bowls' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'camping plates', 'https://www.falconenamelware.com/pages/picnic-plates', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='camping plates' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 23, 'https://www.falconenamelware.com/pages/picnic-plates' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='camping plates' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 20, 'https://www.falconenamelware.com/pages/picnic-plates' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='camping plates' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'appetiser plate', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='appetiser plate' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='appetiser plate' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='appetiser plate' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'bakeware', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='bakeware' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='bakeware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='bakeware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'baking supplies', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='baking supplies' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='baking supplies' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='baking supplies' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'bbq plates', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='bbq plates' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='bbq plates' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='bbq plates' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'camping mugs', 'https://www.falconenamelware.com/blogs/journal/best-camping-mugs', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='camping mugs' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='camping mugs' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='camping mugs' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'cast iron teapot', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cast iron teapot' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cast iron teapot' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cast iron teapot' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'christmas baking', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='christmas baking' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='christmas baking' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='christmas baking' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'christmas tableware', 'https://www.falconenamelware.com/pages/christmas-tableware', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='christmas tableware' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='christmas tableware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='christmas tableware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'cookery gifts', 'https://www.falconenamelware.com/pages/cookery-gifts', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cookery gifts' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cookery gifts' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cookery gifts' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'cookie plate', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cookie plate' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cookie plate' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cookie plate' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'cooking utensils', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cooking utensils' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cooking utensils' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cooking utensils' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'cookware', 'https://www.falconenamelware.com/?srsltid=AfmBOoporrS4jqMK5dbq52NMk1vDfYG83igPIFWnBFzImfvsOrV3JAfi', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cookware' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cookware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cookware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'copper teapot', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='copper teapot' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='copper teapot' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='copper teapot' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'dessert plate', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='dessert plate' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='dessert plate' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='dessert plate' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'dinnerware', 'https://www.falconenamelware.com/collections/dinnerware', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='dinnerware' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='dinnerware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='dinnerware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamel camping mugs', 'https://www.falconenamelware.com/products/enamel-mug', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel camping mugs' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 32, 'https://www.falconenamelware.com/products/enamel-mug' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel camping mugs' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 31, 'https://www.falconenamelware.com/products/enamel-mug' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel camping mugs' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'great british bake off', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='great british bake off' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='great british bake off' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='great british bake off' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'kitchen accessories', 'https://www.falconenamelware.com/?srsltid=AfmBOopHNtpfyhiATDbzOrWtxRsreX6i4rDXvaTPtRXYy-etzFaHGf0X', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen accessories' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen accessories' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen accessories' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'kitchen set', 'https://us.falconenamelware.com/collections/all', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen set' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'kitchen utensil holder', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen utensil holder' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen utensil holder' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen utensil holder' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'kitchen utensil set', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen utensil set' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen utensil set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen utensil set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'kitchen utensils', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen utensils' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen utensils' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen utensils' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'kitchenware', 'https://us.falconenamelware.com/collections/all', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchenware' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchenware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchenware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'kitchenware accessories', 'https://www.falconenamelware.com/', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchenware accessories' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchenware accessories' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchenware accessories' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'kitchenware direct', 'https://www.falconenamelware.com/collections/kitchenware', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchenware direct' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchenware direct' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchenware direct' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'kitchenware sale', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchenware sale' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchenware sale' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchenware sale' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'lunch recipes', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='lunch recipes' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='lunch recipes' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='lunch recipes' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'metal plate', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='metal plate' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='metal plate' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='metal plate' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'metal teapot', 'https://www.falconenamelware.com/products/tea-pot', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='metal teapot' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='metal teapot' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='metal teapot' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'mince pie plate', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='mince pie plate' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='mince pie plate' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='mince pie plate' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'outdoor dinnerware set', 'https://www.falconenamelware.com/pages/picnic-plates', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='outdoor dinnerware set' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='outdoor dinnerware set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 24, 'https://www.falconenamelware.com/pages/picnic-plates' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='outdoor dinnerware set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'outdoor plate set', 'https://www.falconenamelware.com/pages/picnic-plates', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='outdoor plate set' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 21, 'https://www.falconenamelware.com/pages/picnic-plates' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='outdoor plate set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 20, 'https://www.falconenamelware.com/pages/picnic-plates' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='outdoor plate set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'oven gloves', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='oven gloves' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='oven gloves' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='oven gloves' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'pasta bowl', 'https://www.falconenamelware.com/pages/pasta-bowl-set', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='pasta bowl' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='pasta bowl' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='pasta bowl' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'picnicware', 'https://www.falconenamelware.com/pages/picnic-plates', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='picnicware' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='picnicware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='picnicware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'plate sets', 'https://us.falconenamelware.com/collections/all', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='plate sets' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='plate sets' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='plate sets' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'salad bowl', 'https://www.falconenamelware.com/pages/salad-bowls-for-sharing', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='salad bowl' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='salad bowl' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='salad bowl' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'salad bowl set', 'https://www.falconenamelware.com/pages/salad-bowls-for-sharing', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='salad bowl set' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='salad bowl set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='salad bowl set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'salad plate', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='salad plate' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='salad plate' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='salad plate' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'serving bowl', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='serving bowl' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='serving bowl' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='serving bowl' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'shallow serving bowl', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='shallow serving bowl' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='shallow serving bowl' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='shallow serving bowl' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'shatterproof dishes', 'https://www.falconenamelware.com/blogs/journal/enamel-dinnerware-safe-children', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='shatterproof dishes' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='shatterproof dishes' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='shatterproof dishes' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'side plate', 'https://www.falconenamelware.com/products/small-side-plates', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='side plate' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='side plate' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='side plate' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'small plate', 'https://www.falconenamelware.com/products/small-side-plates', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='small plate' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='small plate' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='small plate' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'tea pots', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tea pots' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tea pots' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tea pots' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'tea set', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tea set' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tea set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tea set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'tea towel', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tea towel' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tea towel' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tea towel' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'teapot set', 'https://www.falconenamelware.com/products/mothers-day-tea-set?srsltid=AfmBOooXKecy_3qqsckhokYUMM7aBNuCghAvrqCJGNGFecP8uuydpemf', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='teapot set' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='teapot set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='teapot set' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'tumblers', 'https://www.falconenamelware.com/products/tumblers', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tumblers' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tumblers' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tumblers' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'utensils', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='utensils' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='utensils' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='utensils' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'vegan recipes', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='vegan recipes' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='vegan recipes' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='vegan recipes' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'vintage kitchenware', 'https://us.falconenamelware.com/collections/all', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='vintage kitchenware' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='vintage kitchenware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='vintage kitchenware' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'vintage teapots', 'https://www.falconenamelware.com/products/tea-pot?srsltid=AfmBOoqukv4Yc_pWv_Itu7d8d9kHpXPyQmeTeFEL76FemIkbPUWCr22z', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='vintage teapots' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='vintage teapots' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='vintage teapots' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'white mug', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='white mug' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='white mug' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='white mug' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'white plate', 'https://www.falconenamelware.com/products/plate-set', 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='white plate' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='white plate' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='white plate' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'white teapot', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='white teapot' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='white teapot' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='white teapot' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'winter recipes', NULL, 'desktop', 2826, 'United Kingdom'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='winter recipes' AND location_code=2826 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='winter recipes' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='winter recipes' AND location_code=2826 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;

-- ===== United States (2840) — 2 date column(s) =====
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamel dinner set', 'https://us.falconenamelware.com/collections/all', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel dinner set' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 2, 'https://us.falconenamelware.com/collections/all' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel dinner set' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 2, 'https://us.falconenamelware.com/collections/all' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel dinner set' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamel kitchenware', 'https://us.falconenamelware.com/collections/all', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel kitchenware' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 1, 'https://us.falconenamelware.com/collections/all' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel kitchenware' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 1, 'https://us.falconenamelware.com/collections/all' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel kitchenware' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamel teapot', 'https://us.falconenamelware.com/pages/teapot', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel teapot' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 1, 'https://us.falconenamelware.com/pages/teapot' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel teapot' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 1, 'https://us.falconenamelware.com/pages/teapot' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel teapot' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamelware mug', 'https://us.falconenamelware.com/products/enamel-mug', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamelware mug' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 2, 'https://us.falconenamelware.com/products/enamel-mug' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamelware mug' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 2, 'https://us.falconenamelware.com/products/enamel-mug' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamelware mug' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'individual pie dishes', 'https://us.falconenamelware.com/products/pie-dishes', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='individual pie dishes' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='individual pie dishes' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='individual pie dishes' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamel dinnerware', 'https://us.falconenamelware.com/collections/all', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel dinnerware' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 3, 'https://us.falconenamelware.com/collections/all' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel dinnerware' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 3, 'https://us.falconenamelware.com/collections/all' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel dinnerware' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamelware plates', 'https://us.falconenamelware.com/collections/all', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamelware plates' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 1, 'https://us.falconenamelware.com/collections/all' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamelware plates' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 1, 'https://us.falconenamelware.com/collections/all' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamelware plates' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamel plates', 'https://us.falconenamelware.com/collections/all', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel plates' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 1, 'https://us.falconenamelware.com/collections/all' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel plates' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 1, 'https://us.falconenamelware.com/collections/all' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel plates' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamelware dishes', 'https://us.falconenamelware.com/collections/all', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamelware dishes' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 1, 'https://us.falconenamelware.com/collections/all' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamelware dishes' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 1, 'https://us.falconenamelware.com/collections/all' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamelware dishes' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamelware', 'https://us.falconenamelware.com/', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamelware' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 1, 'https://us.falconenamelware.com/' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamelware' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 1, 'https://us.falconenamelware.com/' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamelware' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamel mug', 'https://us.falconenamelware.com/products/enamel-mug', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel mug' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 2, 'https://us.falconenamelware.com/products/enamel-mug' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel mug' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 2, 'https://us.falconenamelware.com/products/enamel-mug' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel mug' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'pie dish', 'https://us.falconenamelware.com/products/pie-dishes', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='pie dish' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='pie dish' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='pie dish' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'picnic plates', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='picnic plates' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='picnic plates' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='picnic plates' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'pie tin', 'https://us.falconenamelware.com/products/pie-dishes', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='pie tin' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='pie tin' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='pie tin' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'baking set', 'https://us.falconenamelware.com/collections/all', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='baking set' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='baking set' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='baking set' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'baking pan set', 'https://us.falconenamelware.com/products/bake-set', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='baking pan set' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='baking pan set' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='baking pan set' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'cookery gifts', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cookery gifts' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cookery gifts' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cookery gifts' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'camping plates', 'https://us.falconenamelware.com/products/plate-set', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='camping plates' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='camping plates' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='camping plates' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'tumbler', 'https://us.falconenamelware.com/products/tumblers', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tumbler' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tumbler' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tumbler' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'what is enamel', 'https://us.falconenamelware.com/blogs/journal/what-is-enamelware', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='what is enamel' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 22, 'https://us.falconenamelware.com/blogs/journal/what-is-enamelware' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='what is enamel' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 21, 'https://us.falconenamelware.com/blogs/journal/what-is-enamelware' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='what is enamel' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'baking supplies', 'https://us.falconenamelware.com/pages/baking-supplies-cookware', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='baking supplies' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='baking supplies' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='baking supplies' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'teapot', 'https://us.falconenamelware.com/products/tea-pot', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='teapot' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='teapot' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='teapot' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'bakeware', 'https://us.falconenamelware.com/collections/all', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='bakeware' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='bakeware' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='bakeware' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'camping mugs', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='camping mugs' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='camping mugs' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='camping mugs' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'cast iron teapot', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cast iron teapot' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cast iron teapot' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cast iron teapot' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'christmas baking', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='christmas baking' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='christmas baking' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='christmas baking' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'cooking utensils', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cooking utensils' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cooking utensils' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cooking utensils' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'cookware', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cookware' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cookware' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cookware' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'cookware sets', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cookware sets' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cookware sets' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='cookware sets' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'dinnerware', 'https://us.falconenamelware.com/collections/all', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='dinnerware' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='dinnerware' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='dinnerware' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamel', 'https://us.falconenamelware.com/collections/all', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamel camping mugs', 'https://us.falconenamelware.com/products/enamel-mug', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel camping mugs' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 13, 'https://us.falconenamelware.com/products/enamel-mug' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel camping mugs' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 13, 'https://us.falconenamelware.com/products/enamel-mug' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel camping mugs' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'enamel cookware', 'https://us.falconenamelware.com/collections/all', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel cookware' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', 2, 'https://us.falconenamelware.com/collections/all' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel cookware' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', 2, 'https://us.falconenamelware.com/collections/all' FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='enamel cookware' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'holiday dinnerware', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='holiday dinnerware' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='holiday dinnerware' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='holiday dinnerware' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'kitchen accessories', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen accessories' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen accessories' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen accessories' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'kitchen set', 'https://us.falconenamelware.com/collections/all', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen set' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen set' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen set' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'kitchen utensil holder', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen utensil holder' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen utensil holder' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen utensil holder' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'kitchen utensil set', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen utensil set' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen utensil set' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen utensil set' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'kitchen utensils', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen utensils' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen utensils' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchen utensils' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'kitchenware', 'https://us.falconenamelware.com/collections/all', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchenware' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchenware' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchenware' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'kitchenware accessories', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchenware accessories' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchenware accessories' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchenware accessories' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'kitchenware sale', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchenware sale' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchenware sale' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='kitchenware sale' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'metal plate', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='metal plate' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='metal plate' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='metal plate' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'metal teapot', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='metal teapot' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='metal teapot' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='metal teapot' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'pancake recipes', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='pancake recipes' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='pancake recipes' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='pancake recipes' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'plate sets', 'https://us.falconenamelware.com/collections/all', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='plate sets' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='plate sets' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='plate sets' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'roasting pans', 'https://us.falconenamelware.com/pages/roasting-pans', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='roasting pans' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='roasting pans' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='roasting pans' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'salad bowls', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='salad bowls' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='salad bowls' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='salad bowls' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'shatterproof dishes', 'https://us.falconenamelware.com/blogs/journal/enamel-dinnerware-safe-children', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='shatterproof dishes' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='shatterproof dishes' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='shatterproof dishes' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'tea pots', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tea pots' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tea pots' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tea pots' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'tea set', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tea set' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tea set' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tea set' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'tea towel', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tea towel' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tea towel' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tea towel' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'teapot set', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='teapot set' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='teapot set' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='teapot set' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'thanksgiving baking dishes', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='thanksgiving baking dishes' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='thanksgiving baking dishes' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='thanksgiving baking dishes' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'thanksgiving cookware', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='thanksgiving cookware' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='thanksgiving cookware' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='thanksgiving cookware' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'tumblers', 'https://us.falconenamelware.com/products/tumblers', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tumblers' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tumblers' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='tumblers' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'utensils', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='utensils' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='utensils' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='utensils' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'vintage kitchenware', 'https://us.falconenamelware.com/collections/all', 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='vintage kitchenware' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='vintage kitchenware' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='vintage kitchenware' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'vintage teapot', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='vintage teapot' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='vintage teapot' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='vintage teapot' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'white mug', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='white mug' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='white mug' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='white mug' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'white plate', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='white plate' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='white plate' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='white plate' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'white teapot', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='white teapot' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='white teapot' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='white teapot' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_keywords (client_id, keyword, target_url, device, location_code, location_name)
SELECT 'd981ba28-2898-43a1-8759-c3375b62448f', 'winter recipes', NULL, 'desktop', 2840, 'United States'
WHERE NOT EXISTS (SELECT 1 FROM seo_keywords WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='winter recipes' AND location_code=2840 AND device='desktop');
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-18', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='winter recipes' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;
INSERT INTO seo_rank_history (keyword_id, checked_at, position, url)
SELECT id, DATE '2026-05-19', NULL, NULL FROM seo_keywords
WHERE client_id='d981ba28-2898-43a1-8759-c3375b62448f' AND keyword='winter recipes' AND location_code=2840 AND device='desktop'
ON CONFLICT (keyword_id, checked_at) DO UPDATE SET position=EXCLUDED.position, url=EXCLUDED.url;

COMMIT;
