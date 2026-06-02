# Hillcroft Garden Designer — Build Status

Tracks what's built vs. what's still scoped in `HILLCROFT-GARDENS-BRIEF.md`. We're building
foundation-first, then each integration as its own testable PR (install via one-click update).

## ✅ 0.1.0 — Foundation (this build)

- Plugin skeleton under `dev/hillcroft-gardens/` (WP slug `hillcroft-garden-designer`).
- Glossy, brand-styled admin: Cormorant Garamond + DM Sans, olive/charcoal/cream palette, pill
  buttons, WP left menu kept. Brand colours editable in Settings (CSS variables).
- **Plant catalogue** database + CRUD UI (add / edit / search / filter / paginate / delete),
  full field schema incl. spacing-per-m² and pet/child toxicity flags. Source of truth for
  pricing; CSV import/export to follow.
- **Cost & credits banner** (persistent, colour-coded) + site-wide low-balance admin notice +
  `hgd_api_usage` logging table and roll-ups (spend this month, by API, per project).
- **Settings**: API keys (masked), cost rates, business defaults (consultation fee + milestone
  split), brand colours, and the updater config.
- **GitHub self-updater** for the private repo (token-auth, `hgd-v` tag prefix) — no external
  library. Plus `bin/build-zip.sh` and a release-building GitHub Action.

## ✅ 0.2.0 — Front of funnel (part 1)

- **Projects**: full lifecycle (`lead → complete`), list with status filter + search, create/edit/delete.
- **Clients (CRM)**: contact + address records, linked to projects, find-or-create by email.
- **Lead capture**: `[hgd_enquiry]` public shortcode → creates client + project (`enquiry`) and
  emails Donna via the site mailer. Honeypot spam guard.
- **Design**: brand green/yellow palette (`#9FA145`, `#C8C957`, `#F0F268`, `#777834`) added as
  status badges and accents.

## ✅ 0.3.0 — Forms engine (ported from October Forms)

- Full **multi-step form builder** (drag-drop, 18 field types, conditional logic, per-form
  theming, file uploads, honeypot + rate-limit spam) under the **Designer → Forms** menu.
- **Submissions** viewer + CSV export; **analytics** dashboard (views/starts/completions/funnel).
- **Closed loop**: completed form → creates a Client + an `enquiry` Project (`HGD_Form_Bridge`).
- Embed with `[hgd_form id="N"]`. Brevo, Amazon SES and the external public API were dropped;
  notifications use the site mailer.

## ✅ 0.4.0 — Paid consultation booking + Google Calendar (+ Forms polish)

- Public `[hgd_booking]` page: availability slot picker + **embedded Stripe** card form for the
  £200 consultation. Payment confirmed by **Stripe webhook** → booking marked paid, Client +
  `booked` Project created, `.ics` invite emailed.
- **Google Calendar** (personal Gmail OAuth): busy times block slots; paid bookings written as
  events. Connect/disconnect under Settings; availability rules (days/hours/slot/buffer/lead/window).
- Admin **Bookings** list + "Upcoming consultations" dashboard card.
- **Forms polish**: renamed to just "Forms"; Submissions + Analytics are now **tabs** in a single
  Forms hub; Forms placed correctly in the menu (not first).
- Needs live testing: Stripe payment + webhook, Google OAuth (keys/credentials in Settings).

## ✅ 0.5.0 — Consultation capture + Claude sketch-reading

- Upload sketches + site photos to a project (WP media library; `hgd_project_assets`).
- **Claude** (vision) reads the sketch — interprets layout, reads hand-written dimensions and
  annotations, returns a prose reading + clarifying questions (`ai_reading`/`ai_questions`).
- Token cost logged to the cost banner. Claude model is configurable (default Sonnet 4.6).
- Needs live testing: a real Claude API key.

## ✅ 0.6.0 — Ideas dialogue + Gemini concept renders

- Editable **design brief** + **render prompt** per project; **"Compose with Claude"** drafts both
  from the sketch-reading + ideas (`design_brief`/`render_prompt`, schema v5).
- **Generate render** → Gemini turns the prompt (sketch sent as a reference image) into a
  photorealistic concept; press again to **iterate**; renders saved to the media library as
  `render` assets. Per-image cost logged. Gemini model configurable.
- Needs live testing: real Gemini + Claude keys.

## ✅ 0.7.0 — Pricing engine

- **Good / Better / Best** quotes per project (`hgd_quotes` + `hgd_quote_items`, schema v6).
- Line items from the **plant catalogue** (price snapshotted) + custom material/labour/other lines.
- Totals: materials + **wastage %** + **labour** (days×rate) + **contingency %** + **design fee** +
  **VAT**, tidy headline total; **internal margin** (ex-VAT subtotal − cost) shown to Donna only.
- **Seed Better & Best from Good** via configurable tier uplifts; pricing defaults in Settings.

## ✅ 0.8.0 — Proposals + client portal + milestone payments

- **Proposal** from a chosen quote (`hgd_proposals` + `hgd_payments`, schema v7): deposit +
  commencement + completion milestones, editable intro/terms, 30-day expiry, unique token.
- **Public client portal** (`?hgd_proposal=TOKEN`): standalone brand-styled page — renders,
  client-friendly costs (no margin), payment schedule, terms, **e-sign**, embedded **Stripe**
  deposit payment. Status: `draft → sent → viewed → accepted → deposit_paid → complete`.
- Milestone payments fulfilled by **extending the existing booking webhook** (idempotent, branches
  on `payment_id` metadata). Pay route re-derives amount server-side from the stored row.
- Needs live testing: Stripe payment round-trip + webhook.

## ✅ 0.9.0 — Render pack

- A deliberate set of named views via Gemini, each **anchored to the approved concept render**
  for consistency: `masterplan`, `watercolour` (hero), `plan_handdrawn`, `corner_patio`,
  `corner_border`, `corner_focal` — plus **seasonal** variants and a real **satellite** image
  (Google Static Maps). "Generate full pack" makes the core set; per-image cost logged.
- Schema v8: `view_key` + `label` on project assets; `pack` asset role.
- Needs live testing: Gemini + Google Maps keys.

## ✅ 1.0.0 — Keepsakes (full vision delivered)

- **Plant book**: print-ready HTML (`?hgd_book=<token>` / admin preview `?hgd_book_preview=<id>`) —
  watercolour cover, design-brief intro, one page per plant (from the quote line items) with care
  notes; "Save as PDF" / print-shop ready.
- **Proposal keepsake**: printable record of the proposal (`?hgd_keepsake=<token>`).
- **Seasonal film**: CSS/JS cinematic slideshow of the render pack (`?hgd_film=<token>` / preview),
  linked from the client portal. Dependency-free.

The full original brief is now delivered end to end across 10 releases.

> Note: releases 1.1.0–1.11.0 (guided wizard, plan-first render pipeline, Flux/ControlNet,
> photo-inpainting, structured measurements, approval gate/scorecard, and the WooCommerce
> checkout + receipts work for the consultation and proposal payments) shipped as their own
> PRs and aren't all expanded here — see the `readme.txt` changelog for the full list.

## ✅ 1.12.0 — Maintenance-plan subscriptions (Stripe Billing)

- Recurring garden-care plans **without** the paid WooCommerce Subscriptions extension. Three
  monthly plans (Essential £45 / Full £85 / Premium £140) defined in `HGD_Subscription::plans()`
  (filterable via `hgd_maintenance_plans`).
- Public **`[hgd_maintenance_plans]`** sign-up block → pending `hgd_subscriptions` row + Stripe
  **hosted Checkout** (subscription mode). Stripe owns the recurring charge, SCA/3DS, automatic
  retries and dunning emails — the "auto-retry + emails" requirement met by Stripe Billing rather
  than bespoke cron code.
- Single shared Stripe webhook (via the new `hgd_stripe_webhook_event` action on
  `HGD_Booking_Page`) keeps the local record in step: `checkout.session.completed` activates +
  links a CRM client; `invoice.paid` advances the period and **mirrors a completed WooCommerce
  order** so Woo sends the receipt and stays system-of-record (idempotent on the Stripe invoice
  id); `invoice.payment_failed` → past-due; subscription updated/deleted → status/cancel sync.
- Admin **Maintenance Plans** list (plan summary + subscribers, status, amount, next bill date)
  with cancel-at-period-end. Schema v15 (`hgd_subscriptions`).
- Needs live testing: real Stripe round-trip (Checkout, the webhook events, and the Woo order
  mirror). To avoid duplicate receipts, disable Stripe's own email receipts and let Woo send them.

## ✅ 1.13.0 — Subscription self-service (Stripe Customer Portal)

- Subscribers manage their own plan (update card, view/download invoices, cancel) on Stripe's
  hosted **Customer Portal** — no client login. `HGD_Stripe::create_billing_portal_session()`.
- Tokenised entry `?hgd_manage=<token>` (`template_redirect`) → opens a portal session for that
  customer and redirects. Each `hgd_subscriptions` row carries an unguessable `manage_token`
  (schema v16); legacy rows get one lazily.
- Reach it three ways: a **"Manage your plan"** link on the post-signup success screen; the new
  **`[hgd_manage_plan]`** block (enter email → emailed a secure magic link, neutral response to
  avoid email enumeration); and a **"Manage link"** per subscriber in the admin list.
- Needs live testing: requires the Customer Portal to be activated in the Stripe dashboard
  (test + live) — see `MAINTENANCE-PLANS-STRIPE-SETUP.md`.

## ✅ 1.14.0 — Reports (pipeline + revenue dashboard)

- New **Designer → Reports** screen, read-only, aggregated from the plugin's own tables (no
  WooCommerce queries, no external calls). `HGD_Reports` + `admin/views/reports.php`.
- **Collected revenue** for this month / this year / all time (paid consultations from
  `hgd_bookings` + paid design milestones from `hgd_payments`, bounded by `paid_at`).
- **Recurring**: MRR (active plans, yearly normalised to /12), ARR, active count, new this month.
- **Sales pipeline**: open proposal value (sent/viewed/accepted/deposit-paid) + value & count per
  proposal stage.
- **Projects by status** (links through to filtered Projects list) and a lead → consultation →
  proposal → accepted → complete **funnel**.
- No schema change. Addresses the reporting half of brief item #11; **follow-up automation**
  (reminder emails for un-booked leads / ageing proposals via cron) is the planned next step.

## ✅ 1.15.0 — Follow-up automation (completes brief #11)

- Once-daily WP-Cron job (`hgd_daily_followups`, `HGD_Followups`) sending gentle client-facing
  reminder emails. Scheduled by the activator (≈08:00 site time), cleared on deactivate.
- Three reminders, each individually toggleable with its own day threshold:
  - **Lead nudge** — enquiries/leads with a linked client and no paid consultation after N days.
  - **Proposal reminder** — sent/viewed proposals unanswered after N days (skips expired).
  - **Proposal expiring** — sent/viewed proposals whose expiry falls within N days.
- Idempotent: every reminder is logged in `hgd_followups` (schema v17) and sent at most once per
  record. Whole feature is **off by default** (opt-in master switch), configured under
  **Settings → Client follow-ups**, incl. a booking-page URL for lead-nudge links.
- No new external services — uses the site mailer. Reporting half shipped in 1.14.0.

## ✅ 1.16.0 — CSV import upsert

- Plant-catalogue CSV import is now **update-or-insert**: rows matching an existing plant on
  botanical name + pot size update it instead of duplicating (`HGD_Plant::find_match` / `upsert`).
  Confirmation reports added vs. updated. Export → edit in a spreadsheet → re-import to refresh.
- No schema change. (Export + header-mapped import already existed since the catalogue build; this
  closes the long-standing "CSV import/export" foundation TODO.)

## ✅ 1.17.0 — Encrypt stored secrets at rest

- New `HGD_Crypto`: AES-256-CBC + HMAC-SHA256 (encrypt-then-MAC), key derived from the site's WP
  salts (`wp_salt('secure_auth')`) — no extra secret to store. Payloads are tagged `hgdc1$…`.
- `HGD_Settings` decrypts secrets transparently in `all()` and encrypts them in `save()` (operating
  on the raw stored array so untouched secrets aren't rewritten in clear). One-time idempotent
  `migrate_secrets()` runs on load and encrypts any legacy plaintext; flagged by `hgd_secrets_encrypted`.
- Covers all `SECRET_KEYS` (Claude/Gemini/Flux/Maps/Plant.id keys, Stripe secret + webhook secret,
  GitHub token, Google client secret + refresh token). Graceful: openssl missing → passthrough;
  tampered/unkeyable payload → blank (re-enter in Settings).
- Fixed `HGD_Google_Calendar::disconnect()` to edit the raw option (it previously round-tripped
  `all()`, which would now rewrite secrets in plaintext). Unit-tested the crypto round-trip,
  passthrough, tamper and double-encrypt cases. No schema change.

## ✅ 1.18.0 — Self-hosted brand fonts

- Cormorant Garamond + DM Sans bundled as latin-subset woff2 (`assets/fonts/`, 3 files ≈ 98KB,
  variable fonts shared across weights) with a generated `fonts.css` (`@font-face`, `font-display:swap`).
- Admin enqueue now loads the local `fonts.css` instead of `fonts.googleapis.com`; the public
  booking + maintenance-plan pages also enqueue it (they referenced the families but never loaded
  them) — so no third-party font request anywhere.
- SIL OFL 1.1 compliance: `assets/fonts/LICENSE.txt` bundles attribution + the full licence.
- No schema change. Closes the last foundation TODO (self-host the brand fonts).

## ⏳ Remaining

**Nothing in the dev backlog.** The full 11-point brief (capture → Claude → Gemini → Remotion
film → pricing → client portal + milestone payments → PDFs → enrichment → follow-up automation +
reporting), the **1.1.0 guided-workflow wizard** (Step 1→N with progress + Back/Next; built into
`project-form.php`), the post-1.0 feature set (maintenance-plan subscriptions, self-service,
Reports, follow-up automation), and all three foundation TODOs (below) are delivered as of 1.18.0.

The only outstanding work is **not code** — a live-site verification pass that can't be done from
the repo:

- The Stripe round-trips (Checkout → webhook → Woo receipt, the Customer Portal, the magic-link
  email), once the dashboard setup in `MAINTENANCE-PLANS-STRIPE-SETUP.md` is complete.
- One run of the follow-up cron (`wp cron event run hgd_daily_followups`) against a few aged
  leads/proposals.

Anything beyond that is net-new scope, not part of the original build.

## Known foundation TODOs

- ~~Self-host the brand fonts (currently loaded from Google Fonts in admin).~~ Done in 1.18.0.
- ~~Consider encrypting stored secrets (currently masked plaintext in `wp_options`).~~ Done in 1.17.0.
- ~~Add CSV import/export for the catalogue.~~ Done (export + import; import upserts as of 1.16.0).
