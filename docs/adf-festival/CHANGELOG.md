# ADF Festival — changelog

The plugin self-updates from GitHub Releases tagged `adf-v<version>`. Bump the
`Version:` header in `adf-festival-plugin.php` (and the `Stable tag` in
`readme.txt`) and merge to `main`; the release workflow builds and publishes the
release automatically.

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
