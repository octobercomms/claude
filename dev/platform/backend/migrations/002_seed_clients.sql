-- Seed initial client data

INSERT INTO clients (name, slug, active, briefing_field, monthly_focus, report_recipients, report_schedule) VALUES
(
  'Falcon Enamelware',
  'falcon-enamelware',
  true,
  'Falcon Enamelware is a premium kitchenware brand selling enamel cookware and homeware. They operate 6 Shopify Plus stores (UK consumer, US consumer, EU consumer, Trade UK, Trade US, Trade EU), advertise on Google Ads (UK and US accounts), run Meta and Instagram ads, use Brevo for trade email marketing, Shopify Email for consumer newsletters, sell on Amazon (UK, US, EU - consumer only), and use GA4, Search Console, and Google Merchant Center.',
  'Initial setup - update with monthly focus.',
  '{"monthly": ["adeela@falconenamelware.com", "kam@falconenamelware.com", "lucy@falconenamelware.com", "ruby@falconenamelware.com", "daniel@octobercomms.com"], "weekly": ["adeela@falconenamelware.com", "kam@falconenamelware.com", "lucy@falconenamelware.com", "ruby@falconenamelware.com", "daniel@octobercomms.com"]}',
  '{"weekly_day": "monday", "weekly_time": "10:00", "monthly_day": 1}'
),
(
  'Another Country',
  'another-country',
  true,
  'Another Country is a furniture and homeware brand with a WooCommerce store. They use Google Ads, GA4, Search Console, Meta Ads, Instagram Insights, and Klaviyo for email marketing. No Amazon presence.',
  'Initial setup - update with monthly focus.',
  '{"monthly": ["paul@anothercountry.com", "catherine@anothercountry.com", "deborah@anothercountry.com", "daniel@octobercomms.com"], "weekly": ["paul@anothercountry.com", "catherine@anothercountry.com", "deborah@anothercountry.com", "daniel@octobercomms.com"]}',
  '{"weekly_day": "monday", "weekly_time": "10:00", "monthly_day": 1}'
),
(
  'Goldfinger',
  'goldfinger',
  true,
  'Goldfinger is a design-led brand with a brochure and ecommerce Shopify site. They run Google Ads, use GA4, Search Console, and Meta Ads. No email marketing platform, no Amazon. Weekly reports only - focus on ads performance and organic.',
  'Initial setup - update with monthly focus.',
  '{"monthly": [], "weekly": ["paul@goldfinger.com", "daniel@octobercomms.com"]}',
  '{"weekly_day": "monday", "weekly_time": "10:00", "monthly_day": 1}'
);

-- Seed Falcon connectors (all disconnected initially)
WITH falcon AS (SELECT id FROM clients WHERE slug = 'falcon-enamelware')
INSERT INTO connectors (client_id, connector_type, store_label, status) VALUES
  ((SELECT id FROM falcon), 'ga4', NULL, 'disconnected'),
  ((SELECT id FROM falcon), 'google_search_console', NULL, 'disconnected'),
  ((SELECT id FROM falcon), 'google_ads', NULL, 'disconnected'),
  ((SELECT id FROM falcon), 'google_merchant_center', NULL, 'disconnected'),
  ((SELECT id FROM falcon), 'meta_ads', NULL, 'disconnected'),
  ((SELECT id FROM falcon), 'instagram_insights', NULL, 'disconnected'),
  ((SELECT id FROM falcon), 'shopify', 'Falcon UK (Consumer)', 'disconnected'),
  ((SELECT id FROM falcon), 'shopify', 'Falcon US (Consumer)', 'disconnected'),
  ((SELECT id FROM falcon), 'shopify', 'Falcon EU (Consumer)', 'disconnected'),
  ((SELECT id FROM falcon), 'shopify', 'Falcon Trade UK', 'disconnected'),
  ((SELECT id FROM falcon), 'shopify', 'Falcon Trade US', 'disconnected'),
  ((SELECT id FROM falcon), 'shopify', 'Falcon Trade EU', 'disconnected'),
  ((SELECT id FROM falcon), 'shopify_email', 'Shopify Email (Consumer)', 'disconnected'),
  ((SELECT id FROM falcon), 'brevo', 'Brevo (Trade)', 'disconnected'),
  ((SELECT id FROM falcon), 'amazon_seller', 'Amazon UK', 'disconnected'),
  ((SELECT id FROM falcon), 'amazon_seller', 'Amazon US', 'disconnected'),
  ((SELECT id FROM falcon), 'amazon_seller', 'Amazon EU', 'disconnected');

-- Seed Another Country connectors
WITH ac AS (SELECT id FROM clients WHERE slug = 'another-country')
INSERT INTO connectors (client_id, connector_type, status) VALUES
  ((SELECT id FROM ac), 'ga4', 'disconnected'),
  ((SELECT id FROM ac), 'google_search_console', 'disconnected'),
  ((SELECT id FROM ac), 'google_ads', 'disconnected'),
  ((SELECT id FROM ac), 'meta_ads', 'disconnected'),
  ((SELECT id FROM ac), 'instagram_insights', 'disconnected'),
  ((SELECT id FROM ac), 'woocommerce', 'disconnected'),
  ((SELECT id FROM ac), 'klaviyo', 'disconnected');

-- Seed Goldfinger connectors
WITH gf AS (SELECT id FROM clients WHERE slug = 'goldfinger')
INSERT INTO connectors (client_id, connector_type, status) VALUES
  ((SELECT id FROM gf), 'ga4', 'disconnected'),
  ((SELECT id FROM gf), 'google_search_console', 'disconnected'),
  ((SELECT id FROM gf), 'meta_ads', 'disconnected'),
  ((SELECT id FROM gf), 'shopify', 'disconnected');
