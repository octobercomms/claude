# Your Architect – Archie (WordPress plugin)

Archie as a **plugin**, so the marketing site can be built freely in WordPress +
Jupiter X + Elementor and Archie is just embedded — not locked into a theme.

- **Code:** [`dev/your-architect-archie/`](../../dev/your-architect-archie/)
- **Embed:** `[archie]` shortcode, or the **Archie** Elementor widget.
- Architecture mirrors the **Hillcroft Garden Designer** plugin (`YAA_` classes,
  encrypted secrets, rate limiting, server-side Claude, shortcode front end).

## How it works

The **server owns the conversation and the pricing**; the client is a thin
renderer. Each turn: user message → Claude (with a `set_fields` tool) → the server
merges the extracted fields, runs the Historic England check on the address,
**recomputes the whole package** (`YAA_Pricing`), and returns `{ message, package, options }`.
Archie never states a price — the panel does. A project record is created from the
first message (cookie-tied), so a returning visitor resumes.

Archie is written as a **helpful guide, not a form**: every question is answerable
by someone with no planning knowledge, defines its jargon, and offers an "I'm not
sure — explain this" path. Each turn he also proposes short **tap-or-type** quick
replies, and the address lookup flags **listed buildings / conservation areas /
London** so the questions adapt to the property.

## Project data model (custom tables, not a CPT)

The project side is backed by **custom tables** (`YAA_DB`), Hillcroft-style — a CPT
+ postmeta made the started-vs-submitted funnel, event tracking and reporting
awkward:

- **`{prefix}yaa_projects`** — one row per visitor (uuid/cookie), with the status
  state-machine (`partial → quoted → submitted / redirected`, plus `abandoned`),
  denormalised columns for fast lists/reporting (email, postcode, london/listed/
  conservation, package, total, submitted_at), and the conversation/state/package
  as JSON.
- **`{prefix}yaa_events`** — an append-only audit + funnel log (`created`,
  `status_change`, `followup_sent`; email/payment events land here in later phases).

**Archie Projects** admin (`YAA_Projects_Admin`) is a branded, site-styled screen
(not the generic CPT list): headline funnel stats, **Started / Submitted / RIBA /
Abandoned** tabs, and a per-project detail view that renders the collected answers
**as a form** (with "stopped at: …") so Tiam can see exactly where people abandon —
alongside the package, the event timeline and the full transcript.

## Theme ↔ plugin separation

Archie lives **entirely in the plugin**. The `archlie` theme prefers the `[archie]`
shortcode whenever the plugin is active (and stands its own scripted demo down, so
there's no double-bind); the demo only runs as a standalone showcase when the plugin
is absent. Rebuild or swap the theme freely — Archie travels with the plugin.

## What's built vs TODO

**Working:** the Claude turn (tool-use field extraction, scoped system prompt),
server-side pricing + package builder, project records + cookie session, the REST
API (`start`/`message`/`remove`/`submit`/`reset`), the `[archie]` shortcode +
Elementor widget with self-contained (theme-proof) styling, **encrypted** API/Stripe
keys, per-session **rate limiting** + a **daily token cap**, admin settings, and a
follow-up cron.

### The studio workflow (built)

A submitted project is driven to paid + delivered inside **Archie Projects**:

1. **Foundations** — custom tables; Projects admin with the started/submitted
   funnel + form-style answers; theme/plugin split.
2. **Approve → email** (`YAA_Email`) — Tiam approve; Claude drafts a "good to go"
   email; Tiam edit + send. Brevo transactional API with **open/click** tracking
   via its webhook (`/brevo-webhook`), else `wp_mail` + a pixel/redirect fallback
   (`/track`). Open tracking is best-effort by nature.
3. **Payment + portal** (`YAA_Stripe`, `YAA_Portal`) — token-gated `[archie_portal]`
   page (auto-created on activation) with the confirmed project, an **embedded**
   Stripe Payment Element while unpaid and a receipt once paid. A signature-verified
   webhook (`/stripe-webhook`) marks the project paid (idempotent) and unlocks files.
4. **Drawings paywall** (`YAA_Files`) — Tiam upload drawings + third-party docs;
   until paid, drawings are served as server-generated **blurred + watermarked**
   previews (or locked placeholders), with originals streamed only through a
   token + payment-checked endpoint (`/file`).
5. **Analytics** (`YAA_Analytics`) — funnel + sales dashboard with date-range
   toggles (revenue, avg value, attach rates, London/listed/conservation splits).

**Marked TODO:**
- **Live Historic England API** (`YAA_Historic_England::api_lookup`) — heuristic
  fallback ships; flip `historic_api_on` once wired.
- **File hardening for production** — store drawing originals outside the web root
  (or behind a deny rule) so a guessed `wp-content` URL can't bypass the gate; the
  access endpoint is the control on this dev build.
- **Stripe Connect payouts** — split to Tiam / appointed consultants if wanted.

## File map

```
your-architect-archie/
├── your-architect-archie.php     Bootstrap (constants, requires, activation)
├── includes/
│   ├── class-yaa-settings.php    Options (secrets encrypted via crypto)
│   ├── class-yaa-crypto.php      AES-256-CBC + HMAC at rest
│   ├── class-yaa-rate-limit.php  Per-session throttle + daily token cap
│   ├── class-yaa-pricing.php     Pricing model + server-side package builder
│   ├── class-yaa-db.php          Custom tables (projects + events) install/upgrade
│   ├── class-yaa-project.php     Project records (custom tables) + cookie session
│   ├── class-yaa-claude.php      Anthropic Messages API wrapper
│   ├── class-yaa-archie.php      System prompt, set_fields tool, turn(), answer_summary()
│   ├── class-yaa-historic-england.php  Listed/conservation/London (heuristic + API hook)
│   ├── class-yaa-rest.php        yaa/v1 endpoints (nonce + rate-limited)
│   ├── class-yaa-shortcode.php   [archie] + assets + Elementor registration
│   ├── class-yaa-elementor-widget.php  "Archie" widget
│   ├── class-yaa-stripe.php      PaymentIntent + signature-verified webhook
│   ├── class-yaa-email.php       Claude-drafted email, Brevo/wp_mail send + tracking
│   ├── class-yaa-portal.php      [archie_portal] client portal (pay / receipt / files)
│   ├── class-yaa-files.php       Uploads, blurred previews, payment-gated download
│   ├── class-yaa-followups.php   Submit emails + partial-lead cron
│   ├── class-yaa-projects-admin.php  Projects screen + workflow (approve/email/files)
│   ├── class-yaa-analytics.php   Funnel + sales dashboard (date toggles)
│   ├── class-yaa-admin.php       Settings screen
│   └── class-yaa-log.php
└── assets/{css/archie.css, css/portal.css, js/archie.js, js/portal.js}
```

## Setup

1. Activate → **Archie Projects → Settings**: Claude API key (stored encrypted),
   model, notification email, ARB/company numbers, rate limits.
2. Drop `[archie]` (or the Elementor widget) on the homepage.
3. Wire Stripe + the portal (the TODO seams) when ready.

Notes: run non-streaming on shared hosting; send mail via an SMTP/API plugin; the
rate limit + token cap bound your Claude spend. Secrets live in the DB **encrypted**,
never in the repo.

---
_Prepared by October Communications._
