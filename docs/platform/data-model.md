# OMI — Data Model

PostgreSQL. Schema built by ~110 numbered SQL migrations in
`backend/migrations/` (`NNN_name.sql`), applied once in order by `run.js` and
tracked in `schema_migrations`. See [deployment.md](deployment.md#migrations).

## Conventions

- **PKs:** UUID (`uuid_generate_v4()`) on core/older tables; `serial` on newer
  ones (video_*, strategy_templates, ai_seo_*, ig_outreach_prospects, …).
- **Timestamps:** most tables have `created_at`/`updated_at TIMESTAMPTZ DEFAULT NOW()`;
  `updated_at` maintained by an `update_updated_at_column()` trigger. Append-only
  logs use a single `ts`/`created_at`.
- **Cascades:** the default is `... REFERENCES clients(id) ON DELETE CASCADE` —
  deleting a client wipes all its data. `ON DELETE SET NULL` is used where
  orphaning is safe (see relationships below).
- **No soft deletes** generally — workflow state is a `status` enum; some tables
  use `active boolean`. Hard delete + cascade is the norm.
- **Idempotent migrations:** `ADD COLUMN IF NOT EXISTS`, `ALTER TYPE ... ADD VALUE IF NOT EXISTS`. Forward-only (no down migrations).
- **JSONB** for flexible config: connector `credentials`, client `report_templates`/`report_schedule`, social `storyboard`, segment `filters`, strategy `phases`, cost-event `meta`, dm-bot `persona`.

## Core tables

| Table | Purpose / key columns |
|-------|-----------------------|
| `users` | Auth/authz. `id` UUID, `username` unique, `password_hash`, `role` (admin/viewer). Admin seeded from env each boot. |
| `user_clients` | **Multi-tenant join.** `(user_id, client_id)` PK, both FK CASCADE. Admins ignore this (see all). |
| `clients` | Root tenant. `id` UUID, `name`, `slug`, `active`, `briefing_field`, `monthly_focus`, `report_recipients`/`report_schedule`/`report_templates` (JSONB), `social_competitors[]`, `competitor_domains[]`, `business_type`, `lifecycle_stage`. |
| `connectors` | Data sources. `client_id` FK CASCADE, `connector_type` (ga4, google_search_console, google_ads, google_merchant_center, meta_ads, instagram_insights, shopify, woocommerce, klaviyo, brevo, shopify_email, amazon_seller, dataforseo, zoho_inventory, cin7, shopify_app), `credentials` JSONB, `store_label`, `status`, `last_checked`, `error_message`. |
| `platform_settings` | **Encrypted secrets store.** `key` PK, `value` TEXT (AES-256-GCM), `updated_at`. Read via `getSetting()`. |
| `reports` | Generated reports. `client_id` FK CASCADE, `report_type` (weekly/monthly), `period_start/end`, `status` (pending→generating→generated→sending→sent/failed), `pdf_path`, `html_path/content`, `error_log`. |

> `report_templates` are a JSONB column on `clients` (`{weekly:{...}, monthly:{...}}`), not a separate table.

## Domain groupings (one line each)

### SEO & rankings
`seo_keywords` (keyword universe, device/location/intent) · `seo_rank_history`
(positions over time + SERP-feature JSON) · `aio_history` (AI Overview presence +
citations) · `ai_visibility_prompts` / `ai_visibility_runs` (prompts tracked
across AI engines) · `ai_seo_keyword_targets` / `ai_seo_article_scans`
(competitor-derived targets + 0–100 fit scoring) · `site_audits` /
`site_audit_issues` (crawl + issues) · `quick_win_dismissed` (rank 11–20 dismissals).

### Social
`social_batches` / `social_posts` (generated post sets) · `social_post_plans`
(conversational planner output) · `social_post_publications` (per-platform
scheduled rows; partial index on pending) · `competitor_posts` (weekly competitor
scrape) · `social_dm_bot` / `social_dm_templates` (DM autoresponder persona + replies) ·
`swipe_items` ("reel → ideas" swipe file: paste a video URL → worker downloads
(yt-dlp) + transcribes (Whisper) → Claude idea card; doubles as the worker queue).

### Outreach & email
`outreach_contacts` (contact universe + verification fields) ·
`outreach_campaigns` / `outreach_sequences` (multi-step) · `outreach_sends`
(per-send status/opens/clicks/bounces, mailbox FK) · `outreach_campaign_contacts`
(M2M) · `outreach_mailboxes` (sender warm-up + daily caps) · `outreach_coupons`.

### PR & editorial
`pr_outlets` (media DB, `merged_into` self-FK) · `pr_contacts` (journalists,
`outlet_id` FK SET NULL) · `pr_editorial_log` (pitched stories + outcomes) ·
`press_releases` (legacy; optional `campaign_id`) · `journalist_responses`
(Featured/Qwoted/SOS queries → drafts) · `pr_coverage_searches` / `pr_thanks` /
`pr_coverage_attachment`.

### Instagram outreach
`ig_outreach_searches` (ICP discovery runs) · `ig_outreach_prospects`
(discovered profiles; `status` new/queued/messaged/replied/skipped; `search_id`
FK **ON DELETE SET NULL** so deleting a search detaches, not deletes; unique on
`(client_id, lower(username))`) · `ig_outreach_autopilot` (per-client schedule).

### Ecommerce
`shopify_pairing_tokens` · `shopify_app_events` (forwarded webhooks) ·
`shopify_gdpr_requests`. (WooCommerce ingest via `wp-connect`.)

### Ads & creatives
`brand_assets` (logo/product/palette/font/guideline) · `ad_creative_batches` /
`ad_creatives` / `ad_creative_images` (AI ad concepts + renders) · `competitor_ads`.

### Content production
`content_drafts` (Claude articles) · `content_publications` (WordPress/Shopify/
clipboard/docx targets) · `url_gap_runs` / `url_gap_keywords` (competitor gap) ·
`backlink_prospects`.

### Strategy
`strategy_templates` (reusable playbooks by business_type × lifecycle_stage) ·
`client_strategy` (per-client snapshot, `template_id` FK SET NULL).

### Audiences
`audience_segments` (saved segments + filters JSON) · `audience_postcode_cache`
(first-party postcode aggregation) · `audience_customer_lists` (lookalikes).

### Video
`video_projects` (edit jobs + status + score) · `video_clips` (uploads) ·
`video_jobs` (worker queue: stage ingest/roughcut/caption/grade/export; claimed
via `SKIP LOCKED`).

### Clarity / CRO
`client_clarity` (Clarity API token, encrypted) · `clarity_cro_reports`
(generated CRO findings).

### Cost & usage
`api_cost_events` (per-call cost log: provider, feature, cost_usd, client_id,
meta) · `usage_snapshots` (daily provider balance/usage).

### Chat & misc
`client_chat` / `client_context_log` (Data Analyst sessions) · `error_log`
(platform errors).

## Notable relationships

- **Tenancy:** everything cascades from `clients(id)`. Viewers are filtered to
  their `user_clients` rows; handlers also `WHERE client_id = $1`.
- **`ON DELETE SET NULL` (orphan-safe):** `ig_outreach_prospects.search_id`
  (deleting a search detaches prospects — they're recoverable, not lost),
  `pr_contacts.outlet_id`, `pr_editorial_log.contact_id`,
  `outreach_sends.sequence_id`, `ai_visibility_runs.prompt_id`,
  `client_strategy.template_id`, `quick_win_dismissed.keyword_id`.
- **Many-to-many:** `user_clients` (users↔clients), `outreach_campaign_contacts`
  (campaigns↔contacts).
- **Worker queue:** `video_jobs` claimed with `SKIP LOCKED`; grade loop bumps
  `attempt` and re-queues export until score ≥ threshold.

---

_Last verified: 2026-06-28 against `backend/migrations/` (~110 files, latest 108)._
