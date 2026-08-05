# October Marketing Intelligence (WP plugin) — status / TODO

**Surface:** 1 of N — the WordPress/WooCommerce connector plugin.
**Version:** 1.0.0 (first release).

## In scope for v1 (done)

- Mirrors the Hillcroft Garden Designer plugin structure: main file + header,
  `includes/`, `admin/`, `uninstall.php`, `bin/build-zip.sh`, and a repo-root
  GitHub Action release workflow (tag prefix `omi-wp-v`).
- Self-updater that installs release zips from the GitHub repo.
- Pairing flow: 24-char token → one outbound `POST /api/wp-connect/pair` →
  store `client_id` + encrypted `refresh_secret`. Reset connection.
- Outbound, HMAC-SHA256-signed pushes for: orders, customers, products,
  inventory, content (posts/pages), SEO scores (Yoast / Rank Math), and form
  submissions (Gravity Forms / Contact Form 7). Centralised in
  `OctoberMI_Client::send()`. Non-blocking with a small blocking-retry path.
  No historic backfill — only events from the pairing date onward.
- Inbound `POST /wp-json/october-mi/v1/draft` route (bearer = stored secret)
  that creates a WP draft, bypassing `wp/v2/posts`.
- Admin UI under **Tools**: connection status, last sync, event counts, reset,
  and a rolling log of the last 50 outbound calls.
- Docs: `README.md`, `API.md`, this status note.

## Explicitly out of scope for v1 (deferred)

- The platform-side `/api/wp-connect/*` ingest routes — **separate future PR**.
  `API.md` is the spec for that work.
- WordPress.org submission.
- Multisite support.
- Per-event admin notifications.
- Historic order/customer/product backfill.

## Notes / decisions

- `refresh_secret` is encrypted at rest with the same AES-256-CBC + HMAC scheme
  Hillcroft uses for its secrets, keyed from WP salts (no extra secret to store;
  re-pair if salts are rotated).
- The inbound route only ever creates a **draft**, so a leaked secret cannot push
  live content.
- "Events this month" in the admin is counted from the rolling log (capped at 50
  entries); the lifetime counter is exact. A custom table for unbounded history
  was deliberately deferred to keep v1 option-only.
- Product deletion is caught via `wp_trash_post` / `before_delete_post` filtered
  to the `product` post type, since WooCommerce has no dedicated delete hook.

## v1.1.0 — Platform plugin foundation + Blog Autopilot module (this increment)

The connector becomes the **October Marketing Platform** umbrella plugin (client-facing
name; internal `october-mi` slug unchanged). See `PLATFORM-PLUGIN-ARCHITECTURE.md`.

- **Module system** (`includes/class-octobermi-modules.php`): `OctoberMI_Module` base +
  `OctoberMI_Modules` registry; only switched-on modules boot (menus/hooks/assets/cron).
- **Gating UI**: Settings renders a checkbox per capability; disabled = invisible.
- **Top-level admin menu** ("October Marketing"); Settings + module submenus hang off it
  (moved off Tools). Visible strings renamed to *October Marketing Platform*.
- **Dual-mode Claude client** (`includes/class-octobermi-claude.php`): direct (own key,
  encrypted at rest, write-only field) or **proxied via the platform** (managed key never
  stored on-site → revocable). Model defaults: haiku-4.5 / sonnet-5 / opus-5.
- **Blog Autopilot module** (`modules/blog/`): gated submenu, per-site content brief
  (topics, audience, tone, attributed author, cadence, length, publish mode), engine
  status. Pipeline is the next increment.
- Settings: `enabled_modules`, `connect_enabled`, `key_source`, encrypted `claude_api_key`.

### Deferred to the pipeline increment
- Background job runner (WP-Cron + spawned jobs); site-learner (Context Pack);
  DataForSEO/Serper research + clusters/briefs; grounded writer → optimise → fact-check →
  schema/images; editorial queue + approve/publish; weekly scheduler.
- `wp_kses` sanitisation of AI output on save; SSRF-hardened crawler; rate/cost caps.

### Deferred to OMI (platform, `dev/platform`)
- `POST /api/wp-connect/generate` proxy (model allow-list, cost caps, usage logging).
- Dashboard "revoke site" control (rotate `refresh_secret`) + optional remote-disable.
- Enrichment endpoints (keyword/SERP clusters, competitor & subreddit research).

## v1.2.0 — Pipeline groundwork: job runner + site-learner (this increment)

- **Background job runner** (`includes/class-octobermi-jobs.php`): custom
  `{prefix}octobermi_jobs` table, `enqueue()` → WP-Cron single event nudged with
  `spawn_cron()`, per-type handlers registered by modules (so cron requests can run
  them), progress/result/error tracking, auto-trim to 200 rows. All expensive work runs
  here — never in a page request.
- **Context Pack / site-learner** (`modules/blog/class-octobermi-context-pack.php`):
  reads the site's own published pages + posts directly from WordPress (no HTTP fetch → no
  SSRF surface), sends a bounded corpus to Claude, and stores a structured company profile
  (positioning, products, ICP, brand-voice signals, themes, internal-link map, author
  hints). Runs as the `blog_context_pack` job.
- **Blog UI**: "Learn my site" / "Re-learn" button enqueues the job; a company-knowledge
  card renders the pack; `blog-admin.js` polls `wp_ajax_octobermi_blog_job_status` and
  refreshes when done. Button gated on engine availability.

### Still to come (pipeline)
- Keyword/SERP research + clusters/briefs (DataForSEO/Serper), grounded writer → optimise
  (SEO/AEO/voice) → fact-check → schema/images, editorial queue + approve/publish, weekly
  scheduler; `wp_kses` on save; rate/cost caps.

## v1.3.0 — Post generation: writer → sanitised draft → schema (this increment)

The plugin can now produce a real post end to end.

- **Writer** (`modules/blog/class-octobermi-writer.php`): brief + Context Pack → strict-JSON
  article (title, slug, meta description, excerpt, HTML body, tags, FAQ, hero-image prompt,
  internal links used). Premium/E-E-A-T + AEO system prompt: question H2s with answer
  capsules, no invented stats/sources, no AI-tell phrasing, uses the pack's internal links,
  avoids already-published titles.
- **Publisher** (`class-octobermi-publisher.php`): sanitises the model HTML with a tight
  `wp_kses` allow-list (no script/style/iframe/handlers), creates the post as **draft**
  (or auto-publish per brief), bylines the brief's **author**, stores meta description
  (+ Yoast/Rank Math compat), FAQ, tags, hero prompt, and the generated flag.
- **Schema** (`class-octobermi-schema.php`): front-end JSON-LD for generated posts —
  `BlogPosting` + real `Person` author (with `sameAs`) + `Organization` + `FAQPage`.
- **UI**: "Generate a post now" (optional topic) runs as a background `blog_generate` job;
  an **editorial queue** lists engine posts with status/author/edit/view; the job poller now
  handles multiple job types on one screen.

### Still to come
- Weekly **scheduler** (auto-generate on cadence); topic/keyword **research planner** and
  connected DataForSEO/Serper enrichment; AI **hero images**; per-site rate/cost caps;
  the OMI-side generate proxy + revoke control.

## v1.4.0 — Autopilot scheduler (this increment)

- **Scheduler** (`modules/blog/class-octobermi-scheduler.php`): opt-in recurring generation.
  Custom cron intervals (weekly / biweekly / monthly), a recurring event that queues a
  `blog_generate` job on the brief's cadence, and re-scheduling whenever the brief changes.
  Guarded: only runs when the module is enabled and the engine is available; posts still
  land per the brief's publish mode.
- **Brief**: new `autopilot` toggle; the page shows the next scheduled run.
- **Module lifecycle**: modules gained `deactivate()`; switching Blog off clears its
  schedule. Turning autopilot on/off (or changing cadence) reschedules immediately.

### Still to come
- Topic/keyword **research planner** + connected DataForSEO/Serper enrichment; AI **hero
  images**; per-site **rate/cost caps**; the **OMI-side** generate proxy + revoke control.
