# October Events — changelog

The plugin self-updates from GitHub Releases tagged `oe-v<version>`. Bump the
`Version:` header in `october-events.php` (and the `Stable tag` in `readme.txt`)
and merge to `main`; the release workflow builds and publishes the release
automatically.

## 1.15.0 — email co-pilot (Claude drafts campaigns)

Phase 5 of the email platform — the differentiator. Brief Claude in plain
language and it returns a finished campaign as editable builder blocks, in the
trained house voice, grounded in live festival data.

- New `OE\Mail\Copilot`: builds a draft from a brief (+ conversation + the
  current blocks for edits), using the AI Stories voice guide + examples as the
  system prompt and a compact **festival-data context** (confirmed upcoming
  events with dates/price/location/link, recent stories) as the only source of
  facts and links.
- **Guardrails**: output is strict JSON validated against the builder's block
  schema (heading / text / image / button / divider / spacer) and sanitised;
  image blocks come back as placeholders (suggested alt, no URL — you pick the
  real image); button links must be real URLs from the data; unverifiable facts
  become visible `[TODO: confirm …]` placeholders; the model never adds the
  unsubscribe/footer (the sender does).
- **REST** `POST oe/v1/campaigns/copilot` → `{ reply, subject, preheader,
  blocks }`. The platform's campaign editor gains an **AI co-pilot** panel:
  brief it, it fills the subject/preheader and loads blocks onto the canvas;
  follow-up briefs refine the draft in place.
- Reuses the existing Claude connector + tone-of-voice training. No schema change.

## 1.14.0 — retire Brevo (native transactional email)

Brevo is removed. Now that native contacts, SES sending, deliverability and
campaigns are in place, all email is owned by the plugin — no third-party
service, no list-ID mapping.

- New `OE\Mail\Transactional`: branded native HTML templates for every triggered
  email (account welcome, payment confirmed, submission received/approved/
  rejected, ticket delivery, volunteer confirmed/declined/reminder, daily sales
  report), sent through the site Mailer (SES when configured, else the site's
  default transport).
- The **monthly digest** now sends as a native campaign to all subscribers —
  reusing the throttled sender, open/click tracking and one-click unsubscribe.
- **Removed**: the `BrevoConnector`, the Brevo API key, and the Brevo template-ID
  / list-ID mappings in Settings. Contact capture stays (native contacts already
  record every signup); audiences replace the old Brevo lists.
- The **Email** admin screen now shows the transport status, native contact/
  audience counts and the email log instead of Brevo lists.
- **SMS** via Brevo is retired; volunteer-reminder SMS is a no-op until AWS End
  User Messaging lands (email reminders are unaffected). No schema change.

## 1.13.0 — email campaigns: bulk sender + tracking (backend)

Phase 4 (backend half) of the email platform — the campaign engine the platform's
drag-and-drop builder will drive. (The builder UI lands next.)

- New `oe_campaigns` + `oe_messages` tables (DB version → 6): a campaign holds the
  builder block JSON + rendered HTML, an audience, schedule, status and stats;
  one message row per recipient with a tracking token.
- **Audiences** resolved from native contacts — *all subscribers*, *SMS opt-in*,
  or *by source* (account / ticket / volunteer / submission), each with a live
  count.
- **Throttled bulk send**: queuing skips suppressed addresses; a new per-minute
  cron tick (`oe_mail_dispatch`) drains the queue in batches of 100 through the
  site Mailer (SES), so a blast never exceeds send limits. Scheduled campaigns
  auto-start at their time.
- **Compliance built into the send path**: every message gets the
  `List-Unsubscribe` headers + an unsubscribe footer (with the configurable
  physical address), an **open pixel**, and **click-tracking** links (HMAC-signed
  so the redirect can't be abused as an open redirect).
- **REST** `oe/v1/campaigns` (+ `/{id}`, `/{id}/test`, `/{id}/send`) and
  `/audiences` for the builder. **Send test** delivers a no-tracking preview.

## 1.12.0 — deliverability spine (unsubscribe + SES bounce/complaint)

Phase 3 of the email platform — the compliance + list-hygiene plumbing that has
to exist before any bulk send.

- **One-click unsubscribe** (`OE\Mail\Unsubscribe`): a signed, no-login link
  (`?oe_unsub=…&k=…`) + the `List-Unsubscribe` / `List-Unsubscribe-Post` headers
  email clients use for their built-in unsubscribe button (RFC 8058). Hitting it
  adds the address to the suppression list and marks the contact unsubscribed; a
  hosted confirmation page is shown for the GET link.
- **SES bounce/complaint ingestion** (`OE\Mail\SnsController`): a public
  `POST oe/v1/ses-sns` endpoint for the SNS topic SES publishes to. Permanent
  bounces and complaints are auto-suppressed (and the contact unsubscribed),
  keeping bounce/complaint rates low so AWS doesn't throttle. Every message's
  **SNS signature is verified** against the AWS signing certificate first, and
  subscription confirmations are auto-confirmed.
- No schema change (uses the existing suppression + contacts tables).

## 1.11.0 — native contacts (kills the manual import)

Phase 2 of the email platform: a unified, de-duplicated contact list built from
the data the plugin already owns, so contacts never have to be imported by hand
again.

- New `oe_contacts` table (auto-created on upgrade; DB version → 5): email
  (unique), name, phone, sms_opt_in, source, status.
- `OE\Mail\Contacts` — `capture()` (insert/merge, de-duped on email, fills blanks
  only, never silently re-subscribes), `backfill()` from accounts, ticket buyers
  and volunteers, plus search/counts/unsubscribe.
- **Forward-fill**: every account creation, ticket order, volunteer signup and
  listing submission now also captures a native contact (alongside the existing
  Brevo upsert), so the list stays current.
- **Contacts** admin screen: totals (subscribed / unsubscribed / SMS opt-in), a
  recent list, and a one-click **Rebuild from existing data**.
- Honours the suppression list — a suppressed email is captured as unsubscribed.

## 1.10.0 — email foundation: Amazon SES site mailer + log + suppression

Phase 1 of the email platform (see docs/october-events/EMAIL-PLATFORM.md). October
Events can become the site's outgoing-mail transport, so the SMTP/log plugins can
be retired. **Off by default** — until SES is enabled and configured, the site's
mail is untouched.

- **Amazon SES transport**: when enabled, all `wp_mail()` routes through SES via
  SMTP (configured on `phpmailer_init`), with a configurable From name/address.
- **Email log** (`oe_email_log`): every send recorded (to, subject, status,
  driver, error) — replaces "Check & Log Email". Visible under **Email**, with a
  **send-test** button.
- **Suppression list** (`oe_suppression`): unsubscribes/bounces are honoured on
  every send — suppressed recipients are stripped, a fully-suppressed message is
  skipped. (SES→SNS bounce ingestion comes in a later phase; the table + checks
  exist now.)
- **Settings → Email (Amazon SES)**: enable, region, SMTP user/password
  (encrypted at rest, or `OE_SES_SMTP_PASSWORD`), From name/address.
- New tables auto-create on upgrade (DB version → 4). Degrades gracefully: with
  no SES config the mailer is a transparent logger.

## 1.9.0 — platform branding (per-site theme)

The planning platform now adopts the October "Marketing Intelligence" design
system, and each site can override the look from here.

- **Settings → Branding (platform theme)**: accent colour, text-on-accent,
  sidebar colour, page background, light/dark **logo** URLs, and an optional
  **custom font** (family + stylesheet URL). Blank = the built-in October
  defaults (Brockmann + brand yellow).
- New **public** REST endpoint `GET oe/v1/brand` (no auth — the platform's
  sign-in screen themes before login) returns the brand name + any non-empty
  overrides; the platform applies them as CSS variables at runtime.
- No schema change.

## 1.8.3 — CORS: take sole ownership on our routes (beats JetEngine for real)

1.8.2 still lost: JetEngine's `rest_pre_serve_request` CORS callback runs *after*
even a `PHP_INT_MAX` handler, so cleaning up afterwards couldn't win — the live
preflight still returned two `Access-Control-Allow-Origin` values
(`…pages.dev`/custom domain **and** `*`).

- `OE\Cors` now hooks `rest_pre_dispatch` (which runs *before*
  `rest_pre_serve_request`) and, for `/oe/v1` requests only, **removes every other
  `rest_pre_serve_request` handler** — core's origin echo and JetEngine's blanket
  `*` alike — so our handler is the single source of CORS on our routes. Entries
  are unset directly, so closure-based callbacks are caught too. JetEngine's CORS
  is untouched on its own routes.

## 1.8.2 — CORS: win against late header appenders (JetEngine)

Follow-up to 1.8.1. On sites running **JetEngine**, every REST response gets a
blanket `Access-Control-Allow-Origin: *` appended *after* core's CORS — so our
1.8.1 handler (which ran at priority 20) cleaned up too early and the stray `*`
came back, leaving two values and a blocked browser request.

- `OE\Cors` now runs at **`PHP_INT_MAX`** on `rest_pre_serve_request`, so it's the
  last code to touch the headers: it strips the duplicate `Access-Control-Allow-
  Origin` (core's echo + JetEngine's `*`) and emits exactly one value for an
  allowed origin. Only affects `oe/v1` routes; JetEngine's own CORS is untouched
  elsewhere.

## 1.8.1 — CORS for the planning platform

Lets the off-site planning platform SPA call the `oe/v1` REST API from the
browser. WordPress core echoes the request Origin already, but many hosts /
security plugins *also* add a blanket `Access-Control-Allow-Origin: *`, and a
browser rejects a response that carries the header twice ("contains multiple
values … but only one is allowed").

- New `OE\Cors`: for `oe/v1` routes it takes ownership of the CORS headers —
  strips whatever was set (core's echo + a stray `*`) and emits exactly one
  valid `Access-Control-Allow-Origin` for an allowed origin, plus a clean
  preflight (methods, `Authorization`/`Content-Type` headers).
- **Settings → Planning platform (CORS)**: the allowed origins, one per line.
  Defaults to `october-platform.pages.dev` and
  `platform.atlantadesignfestival.net`, so it works out of the box.
- Note: PHP can only override headers it set; if a duplicate `*` is added by the
  web server itself (Apache `Header always set`, nginx `add_header`) it must be
  removed there.

## 1.8.0 — volunteer management API

A REST surface over the existing volunteer signups so the platform can give
Ashleigh a full management view (the same operations as the wp-admin Volunteers
screen, friendlier). No schema change — it reads/writes the existing
`oe_volunteer_signups` table.

- **REST** `oe/v1/volunteers/*` (auth: can-edit):
  - `GET /volunteers/opportunities` — every opportunity with capacity vs filled
    across its shifts and how many signups still need a decision.
  - `GET /volunteers/opportunity/{id}` — shifts (capacity, spots left, full) with
    the signups attached to each.
  - `POST /volunteers/opportunity/{id}/signup` — manually place a volunteer on a
    shift (bypasses the open/capacity gate; staff-placed signups start confirmed
    and still fire the confirmation + reminders).
  - `POST /volunteers/signup/{id}` — set status (confirm / decline / no-show /
    re-open) and/or toggle check-in.
  - `DELETE /volunteers/signup/{id}` — remove a signup.
- New read models on `OE\Volunteers` (`opportunity_summary`,
  `opportunity_detail`, `signup_dto`) and a `for_opportunity` query.

## 1.7.0 — shared Tasks

A shared, department-grouped task list for the whole team (replacing the
single-user Notion board) — org-wide, so it lives on the hub and is exposed to
the platform.

- New `oe_tasks` table (auto-created on upgrade; DB version → 3).
- **Tasks** admin screen: add/edit, grouped by department, inline status change
  (To do / In progress / Blocked / Done), due date, assignee, notes, delete.
- **REST** `oe/v1/tasks` (+ `/task/{id}`, `/tasks/meta`) — list/create/update/
  delete for the platform's Tasks board (auth: can-edit-events).
- Departments default to the festival's existing groups (Admin, Advertising,
  Content Marketing, Email, PR, Media Partners, Partners & Sponsors, Social,
  Website Dev, Website Support, Uncategorized).

## 1.6.0 — event planning + confirm→green (PM platform phase 1)

The first slice of the project-management platform, in the plugin (usable in
wp-admin now; the same data feeds the platform UI later via REST).

- **Confirm→green gating engine** (`OE\Planning\Gating`): an event can only be
  confirmed once the required fields are complete. Default required set = Elayne's
  essentials — **title, dates & times, price, location** — configurable under
  **Settings → Event readiness**.
- **Event planning** (`OE\Planning\Events`): canonical event info + sessions +
  internal notes stored as `_oe_plan_*` meta on the `events` CPT.
- **Event readiness meta box** on each event: a live checklist, the planning
  fields, a sessions list, and a **Confirm — go green** button that's disabled
  until complete. Confirming **publishes** the event to the public site;
  un-confirming returns it to in-progress.
- **Event Planning** admin screen: every event with a completion meter, status,
  and what it still needs.
- **REST** (`oe/v1/planning/*`): list events, read/update one, and confirm — the
  endpoints the platform's Events board will use (auth: can-edit-events).
- No schema/table changes; status auto-drops from green if a confirmed event later
  becomes incomplete.

## 1.5.0 — renamed to October Events (multi-site)

The plugin is renamed from **ADF Festival** to **October Events** so one codebase
can run on multiple sites (Atlanta Design Festival, Architecture Tours, …) under a
per-site brand set in **Settings → Brand**.

- Identifiers renamed: namespace `ADF\` → `OE\`, constants `ADF_*` → `OE_*`, text
  domain, slug (`october-events`), REST namespace (`oe/v1`), shortcodes (`oe_*`),
  release tags (`oe-v*`), and the data identifiers — tables (`wp_oe_*`), options
  (`oe_*`), and post meta (`_oe_*`) / our CPT slugs (`oe_*`).
- **One-time data migration** (`Activator::migrate_legacy()`, idempotent): renames
  the old `adf_*` tables/options/meta and `adf_*` post types to `oe_*` on first
  load — no manual data work.
- **Back-compat shims** (`Compat`): the old `[adf_*]` shortcodes still render, and
  the old `adf/v1/stripe-webhook` URL still works, so live pages and the Stripe
  webhook keep functioning during the transition.
- The encryption-key derivation is kept stable so secrets stored before the rename
  still decrypt.
- **Manual steps for the live ADF site** (slug change ⇒ the self-updater can't
  cross to the new slug automatically):
  1. Upload/activate the **October Events** plugin once (it migrates the data),
     then deactivate the old "ADF Festival" plugin.
  2. Rename any `ADF_*` constants in `wp-config.php` to `OE_*`
     (e.g. `ADF_STRIPE_SECRET_KEY` → `OE_STRIPE_SECRET_KEY`).
  3. Update the Stripe webhook URL to `…/wp-json/oe/v1/stripe-webhook` (the old
     `adf/v1` alias keeps working until you do).
  4. Set the site's display name under **Settings → Brand**.
- No feature changes; ads remain in the standalone oc-ad-manager plugin.

## 1.4.0 — separate the Ad Manager

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
