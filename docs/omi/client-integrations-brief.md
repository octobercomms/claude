# October Marketing Intelligence — Client Integrations Brief

Brief for a fresh agent picking up the work to make connecting client apps to the **October Marketing Intelligence** platform (nvelope.co) easier and more durable.

Four surfaces in scope. They're independent of each other; start in whatever order you / the human agree.

---

## Why this work exists

The platform integrates with ~15 third-party tools per client (Google Ads, GA4, Search Console, Merchant Center, Shopify, WooCommerce, Meta, LinkedIn, Klaviyo, Amazon Seller, Zoho, etc.). The integrations break constantly. Today's PM2 connector health check flagged 22, 9, 8, 8, 8, 10, 3, 3, 3, 3, 3, 4, 4 issues across consecutive runs. The most painful failure modes:

- **WooCommerce** — Cloudflare Browser Integrity Check / Sucuri WAF challenges our REST API calls and returns the JS-challenge HTML page as a `401`. Today's logs:
  > `WooCommerce returned 401 Unauthorized · Response was HTML ("Security Verification")`
- **Google connectors** — user-OAuth refresh tokens get revoked when staff change passwords, leave the company, or simply remove the grant. GA4 `400`s recur across clients.
- **Shopify** — per-client manual OAuth dance is fragile and not branded.
- **Onboarding clients** is slow because there's no packaged setup artifact for tracking (GTM, pixels, etc.).

All four surfaces in this brief reduce the breakage rate, the onboarding time, or both.

---

## The four surfaces (overview)

| # | Surface | Repo location | Build effort | Primary pain solved |
|---|---|---|---|---|
| 1 | **WordPress plugin** | `dev/october-mi-wp/` (new) | ~3 weeks | WooCommerce + WP data, bypasses WAFs entirely |
| 2 | **Shopify app** (public listing) | `dev/october-mi-shopify/` (new) | ~5-6 weeks + Shopify review (1-2 weeks) | Branded onboarding, webhook-driven sync, App Store distribution |
| 3 | **GTM container template** | `docs/october-mi-gtm/` (new, JSON + docs) | ~3 days | Packaged tracking onboarding artifact |
| 4 | **Google dual-auth** (in-platform) | `dev/platform/backend/` (existing) | ~3 weeks, 5 mergeable slices | OAuth fragility — adds service-account / MCC-link path |

All four are branded **October Marketing Intelligence**. The platform itself is still **OMI** internally; these client-facing surfaces use the OMI brand.

---

## Repo conventions (read first)

This repo holds multiple apps under `dev/<app>/` and matching docs under `docs/<app>/`. See `CLAUDE.md` at repo root for the full rules. Specifically:

- New WP plugin: code in `dev/october-mi-wp/`, docs in `docs/october-mi-wp/`
- New Shopify app: code in `dev/october-mi-shopify/`, docs in `docs/october-mi-shopify/`
- GTM container template (JSON + install instructions): `docs/october-mi-gtm/`
- Google dual-auth: modifies the existing `dev/platform/` codebase, docs updates go in `docs/omi/`

The Hillcroft Garden Designer plugin (`dev/hillcroft-gardens/`) is the existing reference pattern for a self-hosted WP plugin with versioned releases + auto-updater — mirror its structure.

---

## 1 — WordPress plugin: `october-mi-wp`

**Slug:** `october-marketing-intelligence`
**Display name:** October Marketing Intelligence
**Distribution:** Self-hosted, versioned via GitHub releases + self-updater (mirror Hillcroft pattern). Not WP.org — too slow, and we want fast iteration.

### The core idea — reverse the data direction

Today the platform polls the client's WooCommerce/WP REST API from `platform.octobercomms.com`. Every modern WP host has a WAF (Cloudflare, Sucuri, Wordfence) that challenges those requests and returns HTML instead of JSON.

The plugin **flips the direction**: the WP site initiates outbound HTTPS requests to `platform.octobercomms.com/api/wp-connect/...`. Server-initiated egress is never WAF-challenged. Same data, no breakage.

### Install + pairing flow

1. Agency uploads the plugin ZIP to the client's WP site (or sends the client a link).
2. Activate → settings page at `Tools → October Marketing Intelligence`.
3. Settings page has one field: **Pairing token** (24-char string from the OMI dashboard).
4. Click Connect → plugin makes a single test call to the platform with the token → platform responds with the `client_id` it's bound to → plugin stores `client_id` + a refresh secret and starts pushing.

### What the plugin pushes (initial scope)

| Event | Trigger | Endpoint |
|---|---|---|
| Order placed / updated / refunded | WooCommerce hook | `POST /api/wp-connect/orders` |
| Customer created / updated | WooCommerce hook | `POST /api/wp-connect/customers` |
| Product created / updated / deleted | WooCommerce hook | `POST /api/wp-connect/products` |
| Inventory change | WooCommerce hook | `POST /api/wp-connect/inventory` |
| Post / page published / updated | WP `save_post` hook | `POST /api/wp-connect/content` |
| Yoast / RankMath SEO score | On post save | `POST /api/wp-connect/seo` |
| Gravity Forms / CF7 submission | Plugin hook (if active) | `POST /api/wp-connect/form-submission` |

All events are pushed as JSON, signed with HMAC-SHA256 using the refresh secret. Platform validates the signature, rejects replays via a 5-min `X-Timestamp` window.

### What the plugin pulls (publishes from October)

The Organic → Publish step in the platform already supports "publish to WordPress" via the WP REST API. Plugin should expose a more reliable channel for this:

- Platform pushes drafts via `POST /wp-json/october-mi/v1/draft` (authenticated with the same pairing-token bearer) — the plugin route bypasses the standard `wp/v2/posts` endpoint that WAFs love to challenge.

### Admin UI (in `wp-admin`)

- "Connected to: [client name]"
- "Last sync: 2 mins ago"
- "147,283 events pushed this month"
- Reset connection button
- A small log viewer for the last 50 outbound calls

### Backend work on the platform side

- New routes: `POST /api/wp-connect/orders`, `/customers`, `/products`, `/inventory`, `/content`, `/seo`, `/form-submission`
- New table: `wp_connect_events` (id, client_id, event_type, payload jsonb, received_at, processed_at, error_log)
- Workers that ingest these into the existing connector data tables so the rest of the platform sees the WP data the same shape as it would from REST polling
- New connector type `wordpress_plugin` (replaces `woocommerce` once the client is on the plugin — both can coexist for migration)
- Pairing token generator endpoint: `POST /api/clients/:id/connectors/wp/pairing-token` returns a one-time token tied to the client_id

### What's explicitly out of scope for v1

- WP.org plugin directory submission (do this in v2 once stable)
- Multisite support
- Per-event admin notifications
- Pulling historic orders (only push from activation date — historic backfill is a one-off admin script if needed)

---

## 2 — Shopify app: `october-mi-shopify`

**App name:** October Marketing Intelligence
**Distribution:** **Public Shopify App Store listing** (one-time work, ~5-6 weeks build + 1-2 weeks Shopify review). The human has confirmed they want this — "if I do the public listing for Shopify then it's done, it might take time but then it's done."

### Why public listing not custom apps

- Each client installs themselves in one click from the App Store
- Free marketing channel — agency leads find the app
- Shopify manages OAuth scopes, token refresh, GDPR webhooks for you
- Branded — listing page itself doubles as marketing

### Tech stack

Use Shopify's standard Remix template (`shopify app init`). Stack:
- Remix server + Polaris UI for the embedded admin
- Shopify Admin GraphQL API for queries
- Shopify webhook subscriptions for real-time data
- App must be deployed somewhere — recommend the same box as the platform backend, behind `omi.octobercomms.com`

### Pairing flow

1. Client installs from App Store → standard Shopify OAuth flow → app receives access token
2. App's embedded admin shows: "Pair this store with your October Marketing Intelligence account"
3. Client enters their **pairing token** (same generator as the WP plugin — uniform UX)
4. App POSTs the Shopify access token + shop domain + pairing token to the platform
5. Platform stores it, returns OK, embedded admin flips to "Connected to [client name]"

### What gets synced (webhooks, real-time)

- Orders (`orders/create`, `orders/updated`, `orders/cancelled`, `orders/fulfilled`, `refunds/create`)
- Customers (`customers/create`, `customers/update`)
- Products (`products/create`, `products/update`, `products/delete`)
- Inventory (`inventory_levels/update`)
- Theme changes (`themes/publish`) — useful for tracking when the client launched a new design
- Checkouts (abandoned cart signal for marketing automation)

### Mandatory GDPR webhooks

Shopify requires three to be implemented before the App Store will approve:

- `customers/data_request` — return data
- `customers/redact` — delete customer data
- `shop/redact` — delete shop data when app is uninstalled (48h grace)

### Embedded admin (what the client sees inside Shopify)

- Connection status (green dot + "Connected to [client name]")
- Last sync timestamp
- Counts of synced events this week
- Deep link to the client's dashboard in `platform.octobercomms.com`
- Subscription / billing if you charge — start free, decide later

### Backend work on the platform side

- New routes: `POST /api/shopify-app/install` (receives Shopify token + pairing), `POST /api/shopify-app/webhook` (verified webhook receiver)
- HMAC verification of every webhook against the app's API secret
- New connector type `shopify_app` (coexists with the existing `shopify` custom-OAuth one for migration)
- GDPR endpoints

### Out of scope for v1

- Charging clients (later — start free during launch)
- Theme extensions (later)
- Translations (later)

---

## 3 — GTM container template: `october-mi-gtm`

**Format:** A versioned JSON file that the AM imports into the client's Google Tag Manager workspace.
**Distribution:** `docs/october-mi-gtm/october-mi-v1.json` + install instructions in the same folder.

### What's in the container

Pre-built tags + triggers + variables for:

- **GA4** enhanced ecommerce events (purchase, add_to_cart, view_item, begin_checkout, etc.)
- **Meta Pixel** + Conversions API bridging
- **TikTok Pixel** standard events
- **LinkedIn Insight Tag**
- **October MI tracking pixel** — so the platform can attribute on-site behaviour back to its campaigns

### How the AM uses it

1. Open the client's GTM workspace
2. Admin → Import Container → upload `october-mi-v1.json`
3. Choose "Merge" with the existing container
4. GTM prompts for the client-specific values:
   - GA4 measurement ID
   - Meta pixel ID
   - TikTok pixel ID
   - LinkedIn Partner ID
   - October MI client ID
5. Publish — done

### Build effort

~3 days. The JSON is exported from a reference container you've built in your own GTM workspace. The work is:
- Build the reference container properly with all tags / triggers / variables
- Export
- Parameterise (replace literal IDs with `{{ID variable}}` placeholders)
- Write `INSTALL.md` walking the AM through import + variable values
- Version the file (`october-mi-v1.json`, `october-mi-v2.json`, ...) so updates can be re-imported without losing client customisations

### Out of scope

- Auto-installing the container via GTM API (would require OAuth into the client's Google account — defeats the point of a self-serve artifact)
- Per-client variants (one container fits all; client-specific values go in GTM variables not the JSON)

---

## 4 — Google dual-auth (in-platform): `dev/platform/`

**Goal:** Stop user-OAuth refresh tokens from being the only path to authenticate Google connectors. Add a **service-account / MCC-link** path alongside OAuth.

### Why both, not just service-account

- Service account / MCC link is durable and agency-friendly but requires the client to add an email or accept a link request
- OAuth is one-click for the client but breaks when staff change, password rotates, or grant is revoked

Different clients will prefer different paths. Default to service-account / MCC for new connections; keep OAuth working for existing ones and as a fallback.

### Scope

| Connector | Current | Add | What the client does for the new path |
|---|---|---|---|
| Google Ads | User OAuth | **MCC link request** | Accept link request in their Ads UI |
| GA4 | User OAuth | **Service account viewer** | Add `october-mi@<project>.iam.gserviceaccount.com` as Viewer on the property |
| Search Console | User OAuth | **Service account user** | Add same email as User with Restricted Access |
| Merchant Center | User OAuth | **Account link request** | Accept link request in Merchant Center |

### Data model

One column on `connectors`:

```sql
ALTER TABLE connectors ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'oauth';
-- 'oauth' | 'service_account' | 'mcc_link'
```

Existing rows stay on `'oauth'` — no migration of live connections.

### Platform settings (existing encrypted store)

Two keys added to the `SETTINGS_KEYS` allowlist in `dev/platform/backend/src/routes/settings.js`:

- `GOOGLE_SERVICE_ACCOUNT_JSON` — full JSON key file contents (the human pastes it into the existing Settings UI once)
- `GOOGLE_ADS_MCC_ID` — already exists

`loadSettingsFromDb()` in `dev/platform/backend/src/index.js` already copies platform_settings rows into `process.env` on boot — no change needed there.

### The futureproof helper (the key design move)

One file: `dev/platform/backend/src/services/googleAuth.js`

```js
// Single function the rest of the codebase uses for platform-level
// Google auth. Today it reads from process.env. If/when the platform
// later supports multiple agency tenants, THIS function changes (to
// look up by tenantId); nothing else does.
function getPlatformGoogleAuth(scopes) {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not configured in Settings');
  return new GoogleAuth({ credentials: JSON.parse(json), scopes });
}

function getPlatformAdsMccId() {
  return process.env.GOOGLE_ADS_MCC_ID;
}

module.exports = { getPlatformGoogleAuth, getPlatformAdsMccId };
```

This is the only place that touches the platform-level credentials. The connectors call into it.

### Each connector's auth dispatcher

In each Google connector file (`dev/platform/backend/src/connectors/googleAds.js`, `ga4.js`, `searchConsole.js`, `merchantCenter.js`):

```js
async function buildClient(connector, scopes) {
  if (connector.auth_mode === 'service_account' || connector.auth_mode === 'mcc_link') {
    return getPlatformGoogleAuth(scopes);
  }
  return existingOauthClient(connector);  // unchanged
}
```

Existing OAuth code path is untouched. Only new connections opting into mode B take the new branch.

### UI

Per-client Connectors page → "Connect Google Ads" → modal with two radio options:

```
○ Sign in with Google
●  Link my MCC account  (recommended — never expires)
```

For mode B, show the relevant instruction (copy this service-account email / accept the link request) and a single input for the customer/property ID. Same pattern across all four Google connectors.

### Suggested PR slicing

1. **GA4 service-account auth** (1 week) — smallest first slice, attacks today's GA4 `400`s, establishes the helper pattern.
2. **Google Ads MCC link request** (1 week) — biggest UX win for agency-style clients.
3. **Search Console service-account auth** (3 days) — same pattern as GA4, reuses helper.
4. **Merchant Center account link** (3 days) — same pattern as Ads.
5. **UI polish** (3 days) — the two-mode modal across all four connectors, copyable service-account email, "pending acceptance" state for link requests.

Each step independently mergeable.

### Out of scope (the human has explicitly deferred)

- Multi-tenant agency model — keep this single-instance for now. The helper function is the only thing futureproofed; that's enough.
- Migrating existing OAuth connections to service-account — leave them on OAuth, only new ones default to mode B.

---

## Suggested order of work (across all four surfaces)

1. **GTM container** (3 days) — cheap, ships fastest, packageable deliverable
2. **GA4 service-account auth** (first slice of dual-auth, 1 week) — directly fixes today's recurring failure
3. **Rest of Google dual-auth** (~2 more weeks across 4 slices)
4. **WordPress plugin v1** (3 weeks) — fixes the most-broken connector class entirely
5. **Shopify app** (5-6 weeks build + review) — biggest investment, run in parallel with the others

The human said: "ignore the rollout for others to use, we're just future proofing it." So build for single-instance October usage; design the data model so multi-tenancy is later a clean swap, not a rewrite.

---

## Context for the agent picking this up

- Today is **2026-06-08**.
- The platform is live in production at `platform.octobercomms.com`.
- Deployment: `bash /opt/october-source/dev/platform/update.sh` runs on the production box. `git pull` + migrations + frontend rebuild + `pm2 reload october-platform --update-env`.
- All Claude API calls use `claude-sonnet-4-6`.
- British English everywhere. No AI tells.
- Branch naming: `claude/<short-description>` per PR.
- Each PR opens against `main`, gets reviewed, then merged.
- The human's email: `octobercomms@gmail.com`.
- Repo scope for GitHub MCP tools: `octobercomms/claude` only.

### Today's relevant incident (informs the design)

A scheduled weekly report cron ran at 10am London. The PM2 process's `process.env.CLAUDE_API_KEY` held a placeholder (`sk-ant-...`) because the real key was in the DB (`platform_settings` table) but only loaded into env on the *next* restart. Every narrative section's Claude call returned `401 invalid x-api-key`. `templateRenderer.js` absorbed those errors as section bodies (`{ type: 'error', message: '401 ...' }`). The PDF/HTML renderer dumped them straight into the report. An SMTP `Connection timeout` briefly hid the breakage; a manual resend pushed the broken bodies to client inboxes.

Guards landed in PR #421:
- `claude.verifyApiKey()` preflight before any expensive data collection
- Refusal to ship reports with any `type: 'error'` section

Three follow-up improvements were flagged in that PR but not yet implemented:
1. `await loadSettingsFromDb()` before `app.listen()` so the env is populated before cron registration completes
2. `'skipped_no_recipients'` status instead of silent `'sent'` when `report_recipients.weekly/monthly` is empty
3. SMTP retry with exponential backoff

These are separate from this brief but worth knowing about — they sit in the same general "make integrations reliable" theme.
