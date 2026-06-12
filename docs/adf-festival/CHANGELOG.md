# ADF Festival — changelog

The plugin self-updates from GitHub Releases tagged `adf-v<version>`. Bump the
`Version:` header in `adf-festival-plugin.php` (and the `Stable tag` in
`readme.txt`) and merge to `main`; the release workflow builds and publishes the
release automatically.

## 1.4.0 — separate the Ad Manager

- **Removed the ad module from this plugin.** Ads are a cross-site ad network, not a
  festival-specific feature, so they now live solely in the standalone **oc-ad-manager**
  plugin (the festival site runs both). Bundling them in 1.0.0 was the wrong call; this
  corrects it and slims the festival plugin (63 → 48 PHP files).
- Removed: `ADF\Ads\*` (campaigns/creatives/tracking/bookings/serving/partner), the Ads
  admin screens, the `[adf_ad]` / `[adf_ad_book]` shortcodes, the ad REST endpoints
  (`/ad-render`, `/ad`, `/ad-promo`, `/ad-book-intent`) + the webhook `ad_booking` branch,
  the `wp adf migrate-ads` command, and all ad/syndication settings.
- No effect on tickets, listings, volunteers, email/SMS, or the self-updater.
- **Note:** the `adf_ad_*` tables from 1.0.0–1.3.0 are left in place (harmless) rather than
  dropped; remove them manually if you never used the bundled ad system.

## 1.3.0 — security hardening

Addresses the findings from the security audit (IDs reference the audit report):

- **ADF-01 (High) — payment-amount tampering on ticket checkout.** `/ticket-confirm`
  now derives the order solely from the verified PaymentIntent's metadata and
  rejects any order whose total exceeds the amount actually captured, instead of
  re-pricing from the (attacker-controllable) request body.
- **ADF-02 (High) — forged Stripe webhooks.** Unsigned webhook events are now
  rejected unless `ADF_ALLOW_UNSIGNED_WEBHOOK` is explicitly set (local dev only),
  closing free-ticket / fake-"paid" forgery when no signing secret is configured.
- **ADF-03 — check-in PIN brute force.** PIN attempts are throttled per IP+event
  (lock after 10 failures for 15 min).
- **ADF-04 — missing rate limiting / unauth upload.** Per-IP rate limits added to
  the public `ticket-intent`, `ticket-promo`, `volunteer-signup` and `ad-book-intent`
  endpoints; ad-booking uploads are now size- (≤5 MB) and MIME-checked before
  hitting the media library.
- **ADF-05 — secrets at rest.** API keys and the GitHub token are now encrypted in
  the database with libsodium (`Crypto`), keyed off `ADF_ENCRYPTION_KEY` or the WP
  salts. wp-config constants remain the recommended, DB-free option.
- **ADF-06 — confirm-payment authorization.** A listing's payment can only be
  confirmed by its own submitter.
- **ADF-07 — log hygiene.** The debug logger redacts sensitive keys and truncates
  long values (e.g. API response bodies).
- **ADF-08 — reproducible builds.** `composer.lock` is now committed so release
  builds pin exact dependency versions.

## 1.2.0

- **Editable API keys in admin** — Settings → API keys now has fields for the
  Stripe / Brevo / Claude / Google Maps keys with a show/hide (eye) toggle. A
  wp-config.php constant still wins where defined and locks its field; otherwise
  the entered key is stored in the database.
- **Automatic table upgrades** — a DB-version check (`ADF_DB_VERSION`) builds any
  new/changed tables on load via idempotent `dbDelta`, so updates no longer need a
  manual deactivate/reactivate. (1.0.0 → 1.2.0 sites get the ticketing/ads tables
  automatically.)
- **Bundled QR libraries** — `qrcode.min.js` (qrcodejs) and `html5-qrcode.min.js`
  are now shipped, so printed tickets render scannable QR codes and the check-in
  camera scanner works out of the box (no external CDN).

## 1.1.0

Major feature release — full Event Tickets + Ad Manager parity, backend manual
entry throughout, a door check-in PWA, and AI tone-of-voice training.

**AI Stories**
- Editable tone-of-voice training: a house style guide + example pieces feed
  Claude's system prompt on every generation, with a live "Test the voice" box.

**Ticketing (now relational: `adf_orders` / `adf_tickets` / `adf_checkins` / `adf_promo_codes`)**
- Multiple ticket types per event — price, sale price, "admits N" group tickets,
  per-type capacity and sale windows, event-wide sale close, check-in venues + PIN
  (event meta box).
- Orders → tickets model with unique 64-hex tokens; promo codes (percent/fixed,
  event-scoped, expiry, max-uses).
- Public Stripe checkout (`[adf_event_checkout]`) with server-side re-pricing and a
  webhook backup; order-confirmation email.
- Admin Registrations screen with manual comp/paid order entry, cancel + Stripe
  refund, CSV export; Promo Codes CRUD; sales totals + daily sales report.
- QR check-in PWA (`[adf_checkin]`): PIN-gated, camera scanning with manual
  fallback, valid/already/invalid overlays, check-in log.

**Ads (now `adf_ad_campaigns` / `adf_ad_creatives` / `adf_ad_tracking` / `adf_ad_bookings`)**
- Campaign + creative CRUD with a media-library picker (full manual entry),
  cap-aware random rotation, impression/click tracking with de-duplication.
- Ad serving (`[adf_ad]`) via a cache-safe REST render; tracked click redirect.
- Self-serve booking (`[adf_ad_book]`): creative uploads + packages + promo +
  Stripe; admin Activate creates the live campaign; per-campaign report.
- Hub/partner ad syndication (API-key-gated `/ad` feed + cached partner proxy).

**Migrations** — `wp adf migrate-tickets` / `migrate-ads` now import the legacy
plugins' real tables 1:1 (preserving ticket check-in tokens).

**Note:** the relational ticketing/ads tables are created on activation. Since
1.0.0 is already live, deactivate/reactivate once after updating to create the
new tables, then run the migrations.

## 1.0.0

Initial release: accounts, listings (directory/destinations/products/events/
stories), submission/approval, Stripe payments, Brevo email + SMS, volunteer
opportunities with shift signups and reminders, the AI Stories connector, the
Destinations map, the monthly digest, WP-CLI migrations, and the GitHub
self-updater.
