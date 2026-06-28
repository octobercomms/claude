# OMI — Backend

Express app in `dev/platform/backend/src`. Entry point `index.js`, ~43 route
files, ~93 service files.

## Server bootstrap (`src/index.js`)

- Validates `ENCRYPTION_KEY` at startup (fail-fast), prefers IPv4 DNS, registers
  `unhandledRejection`/`uncaughtException` → errorTracker.
- `app.set('trust proxy', 1)` (behind nginx).
- **Helmet** CSP (permissive `default-src 'self'`, inline allowed for
  Claude-authored report HTML in iframes). **CORS** with `credentials: true`,
  origin pinned to `PLATFORM_URL` (prod) / localhost (dev).
- Body parsing: JSON up to 10MB; raw body captured for HMAC webhooks (WP, Shopify).
- On boot: load encrypted settings from `platform_settings`, start the cron
  scheduler, seed the admin user from env.
- Listens on `PORT` (default **3001**). Health check: `GET /api/health`.

### Rate limiters

| Limiter | Window | Max | Applies to |
|---------|--------|-----|------------|
| `globalLimiter` | 15 min | **2500** / IP | `/api/*`, `/auth/*` (accidental loops, UUID brute-force) |
| `authLimiter` | 15 min | 20 / IP | `/api/auth/login`, `/api/auth/change-password` |
| `pixelLimiter` | 60 s | 120 | open-tracking pixel |
| `wpConnectLimiter` / `shopifyAppLimiter` / `videoWorkerLimiter` | 60 s | 1200 | high-volume integration ingest (mounted **before** the global limiter so their traffic isn't capped) |

> The global cap was raised 600 → 2500 because a dashboard load fans out to many
> panel requests; refreshing was tripping it.

## Auth & middleware

**`src/middleware/auth.js`**
- `authenticate` — reads JWT from `Authorization: Bearer` or httpOnly `token`
  cookie, verifies with `JWT_SECRET`, **re-reads `id/username/role` from the DB
  every request** (instant role changes), sets `req.user`. 401 if missing/invalid.

**`src/middleware/clientAccess.js`** — multi-tenant guards, used as:
```js
router.use(authenticate);
router.use(loadVisibleClientIds);                       // req.visibleClientIds (null = admin/all)
router.use(requireClientAccess({ paramNames: ['clientId'] }));
```
- `loadVisibleClientIds` — admins → `null`; viewers → UUIDs from `user_clients`.
- `requireClientAccess({paramNames})` — 403 if a URL param client is out of scope.
- `assertClientAccess(req, clientId)` / `checkClientIdFromBodyOrQuery` — for
  client ids arriving via body/query.
- `requireAdmin` — 403 unless `role === 'admin'`.

## Route catalogue (mount path → file → purpose)

### Auth / users / OAuth
- `/api/auth` → `auth.js` — login, refresh, logout, `/me`, change-password.
- `/api/users` → `users.js` — admin user CRUD + client assignment (guards self-demote/-delete).
- `/auth` → `oauth.js` — provider OAuth start/callback (Google, Meta, LinkedIn, Shopify, Zoho, Amazon). HMAC-signed state, replay protection.

### Clients / connectors / dashboard
- `/api/clients` → `clients.js` — client CRUD (admin), `/readiness` checklist, nested report-template.
- `/api/connectors` → `connectors.js` — connector CRUD, `/test`, `/refresh` (token).
- `/api/dashboard` → `dashboard.js` — visibility-aware client list + alerts.
- `/api/settings` → `settings.js` — platform OAuth/API credentials (admin), connector tests, **AI model routing** (`/ai-models`).
- `/api/security` → `security.js` — security audit runs (admin).

### Reports / strategy
- `/api/reports` → `reports.js` — generate/fetch/HTML(signed-token)/PDF/delete.
- `/api/clients/:id/report-template` → `reportTemplates.js` — conversational template design.
- `/api/strategist` → `strategist.js` — AI strategist reports (list/fetch/read/PDF).
- `/api/strategy` → `strategy.js` — strategy template library + client overview.

### SEO & visibility
- `/api/rankings` → `rankings.js` — keyword tracking + SERP/rank history.
- `/api/seo` → `seoSuite.js` — intent classify, AI Overview history, content gaps, briefs.
- `/api/ai-seo` → `aiSeo.js` — AI keyword targets, article-fit scans.
- `/api/ai-visibility` → `aiVisibility.js` — track prompts in AI Overviews.
- `/api/clarity` → `clarity.js` — Microsoft Clarity sites, reports, CRO scans.

### Social & creators
- `/api/social` → `social.js` — calendars, plans, AI content gen, publish (Meta/TikTok/LinkedIn). Signed media proxy.
- `/api/social/dm-webhook` → `dmWebhook.js` — Instagram DM webhook (Meta HMAC; mounted before global limiter).
- `/api/ig-outreach` → `igOutreach.js` — IG **discovery → manual outreach** queue (searches, prospects, status, drafts, enrich, **client-wide worked list**). See `docs/omi/` and the IG outreach feature.

### Ads & creatives
- `/api/ad-creatives` → `adCreatives.js` — AI ad creative batches (image/video).
- `/api/competitor-ads` → `competitorAds.js` — Ads Transparency Center scans + Claude analysis.
- `/api/brand` → `brandAssets.js` — client brand asset upload/serve.

### Outreach & PR
- `/api/outreach` → `outreach.js` — email prospecting: contacts, campaigns, sequences, sends, HMAC open/click tracking, CSV import.
- `/api/press` → `press.js` — press releases: parse, create, send, mentions.
- `/api/pr` → `pr.js` — PR editorial log, media list, coverage monitor.
- `/api/pr-portal` → `prPortal.js` — public coverage portal + review (token-gated).
- `/api/pr-addon` → `prAddon.js` — Gmail add-on extract (`X-OMI-Key` auth).

### Ecommerce & data
- `/api/sales-traffic` → `salesTraffic.js` — GA4 + ecommerce KPI dashboard.
- `/api/shopify-app` → `shopifyApp.js` — Shopify webhook ingest (HMAC).
- `/api/wp-connect` → `wpConnect.js` — WordPress/Woo pairing + event ingest (HMAC).
- `/api/october-forms` → `octoberForms.js` — October Forms list + submission sync.
- `/api/audiences` → `audiences.js` — segment CSV uploads, postcode distribution.

### AI / chat
- `/api/chat` → `chat.js` — **AI Data Analyst**: multi-round Claude/DeepSeek tool-use loop with per-question model picker (see [integrations.md](integrations.md)).

### Video
- `/api/video` → `video.js` — projects, clips, render, publish. Signed master URLs.
- `/api/video/worker` → `videoWorker.js` — worker poll/claim/complete (`X-Worker-Token`; before global limiter).

### Approvals & public
- `/api/approvals` → `approvals.js` — approval links (admin + public token).
- `/api/integrations` → `integrations.js` — GTM container, WP plugin download (public, no secrets).
- `/api/unsubscribe` → `unsubscribe.js` — signed unsubscribe (public).
- `/api/ses` → `sesWebhook.js` — SES bounce/complaint SNS webhook.
- `/api/waitlist` → `waitlist.js` — homepage waitlist (public).
- `/api/_internal` → `internal.js` — frontend error logging.
- `/api/docs` → `docs.js` — whitelisted internal markdown.

## Services layer (`src/services`)

~93 files. The most load-bearing:
- **`claude.js`** — `callClaude({system,user,max_tokens,model,feature,clientId})`,
  the chokepoint for ~all text/JSON LLM features; per-feature model routing,
  DeepSeek fallback, prompt caching, cost logging. See [integrations.md](integrations.md).
- **`aiModels.js`** — MODELS registry, FEATURES catalogue (`sensitive` flag),
  `resolveModel`, the `AI_MODEL_MAP` setting.
- **`scheduler.js`** — all cron jobs (London time).
- **Integrations** — serper, dataforseo, brevo, shopify, wpConnect, clarity,
  meta/google ads, google OAuth/analytics, hunter/icypeas/apollo/PDL (enrichment),
  elevenlabs/ideogram/replicate/adobe (media), ses/nodemailer (email).
- **Domain services** — reports, strategy/strategist, social (posts/plans/autopilot/dm-bot),
  SEO (rankings, audits, ai-seo, ai-visibility), outreach (campaigns, sends,
  verification, mailboxes), PR (editorial, coverage, press), igOutreach, video,
  audiences, competitor ads/posts, content drafts/publications.

Grouped detail in [integrations.md](integrations.md); full table list in
[data-model.md](data-model.md).

---

_Last verified: 2026-06-28. Counts: 43 routes, ~93 services, ~110 migrations._
