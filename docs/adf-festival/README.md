# ADF Festival plugin

A single WordPress plugin consolidating all operational functions for the
**Atlanta Design Festival** (atlantadesignfestival.net): accounts, listings,
submission/approval, Stripe payments, Brevo email **and SMS**, ticketing,
volunteer opportunities with shift signups and reminders, and an AI Stories
editorial connector. It replaces the legacy **Ad Manager** and **Event Tickets**
plugins.

- **Code:** `dev/adf-festival/`
- **This doc + brief:** `docs/adf-festival/`
- Stack: WordPress + native CPTs/meta, Stripe PHP SDK (Composer), Brevo REST,
  Anthropic Claude API, Google Maps Embed. No WooCommerce, no ACF, no React.

> The original build brief is preserved at
> [`docs/adf-festival/BRIEF.md`](./BRIEF.md). This README documents the **as-built**
> plugin, including where it intentionally deviates from the brief based on the
> live site's real structure.

---

## Key architecture decisions

These three calls were confirmed with the festival team after reviewing the
live WordPress install (JupiterX theme, Elementor Free, Crocoblock/JetEngine).

### 1. Adopt the existing `events` and `volunteer` CPTs (don't duplicate them)

The site already manages **`events`** (rewrite `/e/`) and **`volunteer`**
(rewrite `/v/`) as JetEngine CPTs, with live data and Elementor listings built
on them. Rather than registering parallel `adf_event` / `adf_volunteer` types
and migrating data (as the brief literally proposed), the plugin **adopts** those
two CPTs: it does not re-register them (JetEngine owns registration) and only
layers the shared `_adf_` meta and the submission / payment / email / reminder
logic on top.

All **other** types are registered fresh by the plugin with an `adf_` prefix so
they can never collide with JetEngine:
`adf_directory`, `adf_destination`, `adf_product`, `adf_story`, `adf_ad`, plus the
supporting `adf_account` and `adf_ticket`.

The single source of truth for this mapping is `PostTypes::TYPES` in
`includes/PostTypes.php` (each entry flags `external` for adopted CPTs).

### 2. Hybrid front end

The plugin owns the **gated** surfaces — the account dashboard, submission forms,
Stripe checkout, tickets/QR, volunteer signup widget — and **all** backend logic
and REST endpoints. Public listing pages, the Destinations map, and story pages
stay with **Elementor + JetEngine**, which bind to the data and REST endpoints
the plugin exposes. A dependency-free `[adf_design_map]` shortcode is provided as
a fallback for surfaces not built in Elementor.

### 3. Volunteers: opportunity + shift signups, owned by this plugin, with reminders

The live volunteer flow is an **opportunity listing** (`volunteer` CPT, e.g.
*Blueprints & BBQ — Meet & Greet Host*) with **time shifts** that each have a
fixed slot **capacity**, previously handled by a separate *Sign-up Sheets*
plugin. Per the team's decision, **ADF now owns this end-to-end**:

- Shifts are edited via a meta box on the `volunteer` CPT (label / start / end /
  capacity, one per line).
- Signups are stored in a custom table `{prefix}adf_volunteer_signups`, with
  capacity enforced per shift and double-booking prevented.
- The front-end signup table is rendered by `[adf_volunteer_signup]` (drop it on
  the opportunity template; `opportunity` defaults to the current post).
- **Reminders** cut no-shows: email always (Brevo) and **SMS via Brevo** when
  enabled and the volunteer opted in. Cadence: immediate confirmation on signup,
  then 1 week / 48 hours / morning-of (≈3h) before the shift — all toggleable in
  Settings. An hourly cron scan (`Reminders::run_due()`) fires due reminders and
  records what's been sent so nothing duplicates.

---

## Installation

1. Copy `dev/adf-festival/` into `wp-content/plugins/adf-festival/`.
2. From that folder run `composer install` (pulls the Stripe PHP SDK; the plugin
   degrades gracefully to direct Stripe REST calls if you skip this).
3. Add the API-key constants below to `wp-config.php`.
4. Activate **ADF Festival** in wp-admin. Activation registers CPTs, creates the
   audit-log + volunteer-signups tables, schedules cron, and flushes rewrites.
5. Create a page (e.g. `/my-account/`) containing `[adf_account_dashboard]`.
6. In **ADF Festival → Settings**, map Brevo template + list IDs, set tier
   pricing, AI source URLs, and reminder options.

### wp-config.php constants (secrets never touch the database)

```php
define('ADF_STRIPE_SECRET_KEY', 'sk_live_…');
define('ADF_STRIPE_PUBLISHABLE_KEY', 'pk_live_…');
define('ADF_STRIPE_WEBHOOK_SECRET', 'whsec_…');
define('ADF_BREVO_API_KEY', 'xkeysib-…');
define('ADF_CLAUDE_API_KEY', 'sk-ant-…');
define('ADF_GOOGLE_MAPS_KEY', 'AIza…');
```

---

## Directory layout

```
dev/adf-festival/
  adf-festival-plugin.php     Main entry, autoloader, boot
  composer.json               Stripe SDK + metadata
  readme.txt                  WP manifest (points here)
  includes/                   Core classes (ADF\…)
    PostTypes, Fields, Settings, Account, Submission, Invoice,
    Tickets, Volunteers, VolunteerSignups, Reminders, Cron,
    RestApi, AuditLog, Logger, Updater, Activator, Plugin
    Connectors/               Stripe, Brevo (email+SMS), Claude, Maps
  admin/                      Admin menu, settings, views (ADF\Admin\…)
  frontend/                   Dashboard + templates (ADF\Frontend\…)
  assets/                     css/ js/
  migration/                  WP-CLI importers (ADF\Migration\…)
  bin/build-zip.sh            Packages the installable zip (used by CI)
```

> The release workflow lives at repo root: `.github/workflows/adf-festival-release.yml`.

Classes autoload from the `ADF\` root namespace; the top-level sub-namespaces
`Admin`, `Frontend`, `Migration` map to their folders, everything else to
`includes/`.

---

## REST API (`adf/v1`)

| Route | Auth | Purpose |
|---|---|---|
| `GET /dashboard` | login | Overview counts, tickets, volunteer commitments, invoices |
| `GET /listings` | login | Account's listings (optional `?type=`) |
| `POST /submit` | login (rate-limited) | Create a listing; returns a Stripe client secret for paid tiers |
| `POST /confirm-payment` | login | Advance a listing after client-side payment confirmation |
| `POST /account` | login | Update account contact/billing |
| `POST /volunteer-signup` | public | Book a shift on a volunteer opportunity |
| `GET /volunteer-shifts` | public | Live slot availability for an opportunity |
| `GET /map` | public | Approved, map-visible destination pins |
| `POST /stripe-webhook` | public (signed) | `payment_intent.succeeded`, `charge.refunded` |

---

## Submission & approval pipeline

`includes/Submission.php` is the shared engine for every listing type
(`create → take payment → route → approve / reject`):

- Paid tiers create a Stripe PaymentIntent; the listing sits in
  `pending_payment` until the webhook or client confirmation fires
  `confirm_payment()`, which records an invoice and routes the listing.
- **Auto-approve** publishes immediately and emails the approved variant when the
  account flag covers the listing type; otherwise it queues for review.
- **Rejection** issues a full Stripe refund (when a payment exists), stores the
  refund id, and sends the matching email variant. Rejection copy uses the fixed
  template (with `{listing_name}`, `{listing_type}`, `{refund_amount}`) and any
  per-type admin override.

---

## Scheduled jobs

| Hook | Schedule | Work |
|---|---|---|
| `adf_hourly_cron` | hourly | Volunteer reminder scan (email + SMS) |
| `adf_daily_cron` | daily | AI Stories connector; monthly digest on the first Monday |

The **AI Stories connector** fetches configured RSS sources, runs each new item
through Claude with the ADF editorial prompt, discards `SKIP` responses, and
saves keepers as `adf_story` drafts (`author_type = ai_generated`, source URL
stored for attribution) into the Stories approval queue.

**Tone-of-voice training (Settings → AI Stories):** the voice is tuned in the
admin, not hard-coded. A **house style guide** and **example pieces** are sent to
Claude as the system prompt + voice references on every generation
(`ClaudeConnector::system_prompt()`), and a **Test the voice** box runs a pasted
source through the live prompt so you can iterate until it sounds like ADF.

The **monthly digest** compiles recent stories + upcoming events + listings
flagged `featured_in_email`, sends through Brevo to the digest list, and resets
the flags.

---

## Shortcodes

| Shortcode | Use |
|---|---|
| `[adf_account_dashboard]` | The gated member dashboard (place on `/my-account/`) |
| `[adf_volunteer_signup opportunity="ID"]` | Shift table + signup form on an opportunity page |
| `[adf_design_map]` | Fallback Destinations map (Elementor/JetEngine preferred) |

---

## Migration (WP-CLI, §9)

```
wp adf migrate-ads      [--prefix=wp_] [--dry-run]
wp adf migrate-tickets  [--prefix=wp_] [--dry-run]
```

Both read the legacy plugins' **custom tables** (`ocad_campaigns` / `ocad_ads` /
`ocad_tracking` / `ocad_bookings`, and `oct_orders` / `oct_tickets` /
`oct_checkins`) and are idempotent (records are marked once migrated). Run with
`--dry-run` first to preview. Because events live in the adopted `events` CPT,
`migrate-tickets` imports **ticket** records — preserving each ticket's unique
check-in `token` and linking it to its existing event + matching `adf_account` —
and does not recreate event posts.

> The legacy **Ad Manager** and **Event Tickets** plugins are left completely
> untouched by this work. Keep them active until you've run the migrations and
> verified the new plugin, then deactivate them (the brief's retire step).

---

## Updates & releases (GitHub self-updater)

The plugin updates itself from GitHub Releases, surfaced through WordPress's
normal **Dashboard → Updates** screen (one-click install) — mirroring the
Hillcroft Garden Designer setup.

- **Cutting a release:** bump `Version:` in `adf-festival-plugin.php` and merge to
  `main`. The workflow `.github/workflows/adf-festival-release.yml` reads the
  header, runs `composer install --no-dev`, builds the zip
  (`bin/build-zip.sh`, top folder `adf-festival-plugin/`, `vendor/` bundled),
  and publishes a release tagged `adf-v<version>`. No manual tag push needed.
- **On the site:** `includes/Updater.php` polls the Releases API for the newest
  `adf-v*` tag and offers it. Because this is a private repo, set a fine-grained
  token (Contents: read) under **ADF Festival → Settings → Updates**, or define
  `ADF_GITHUB_TOKEN` in `wp-config.php`. A "Test update connection" button
  diagnoses token/scope/release issues. Downloads handle GitHub's redirect to
  signed storage without leaking the auth header.
- Because the release zip already contains `vendor/`, sites updating this way
  never need to run Composer.

## Notable deviations from the original brief

- **Events/volunteers are adopted, not re-created** (decision 1) — so the brief's
  `adf_event` / `adf_volunteer` slugs are intentionally *not* used; the engine
  works on whatever slug `PostTypes::TYPES` maps the type to.
- **Volunteer model is opportunity + shift signups** (decision 3) rather than the
  brief's flat single-record form, matching the live site.
- **SMS reminders added** (Brevo transactional SMS) — beyond the original brief —
  to reduce volunteer no-shows.
- **Brevo & Claude use direct REST** via `wp_remote_*` instead of bundling PHP
  SDKs, keeping the dependency surface to just the Stripe SDK. Stripe uses the
  SDK when present and falls back to REST otherwise.
- **Invoices** are stored as structured meta and rendered to print-ready HTML
  ("Save as PDF"); a Dompdf/mPDF swap-in point is marked in `Invoice.php`.
- A **local QR library** slot (`assets/js/qrcode.min.js`) is provided to honour
  the "no external CDN for core" rule; the ticket view falls back to the ticket
  number until a library is dropped in.
