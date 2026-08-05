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

**Marked TODO (model on Hillcroft):**
- **Live Historic England API** (`YAA_Historic_England::api_lookup`) — a heuristic
  fallback ships; flip `historic_api_on` once wired.

### Studio workflow roadmap (agreed direction)

The `projects` + `events` tables are the foundation for the studio workflow, built
in phases:

1. **Foundations** *(done)* — custom tables, the Projects admin with the
   started/submitted funnel + form-style answered-questions view, theme/plugin split.
2. **Approve → email** — Tiam approve a project; Claude drafts a "good to go"
   confirmation email; Tiam edit + send. Send via a transactional provider (Brevo)
   with **open/click** tracking via its webhooks (open tracking is best-effort).
3. **Payment + portal** — an **embedded** Stripe Payment Element on a token-gated
   `yourarchitect` portal page next to the confirmed project details; the page
   becomes the client's home (receipt, their uploads, Tiam's drawings).
4. **Drawings + paywall** — Tiam upload drawings; until paid they're served
   **watermarked + blurred** (enforced server-side, originals via signed URLs on
   payment). Third-party docs (e.g. surveyor — paid directly to them, not Tiam)
   upload as a separate file kind.
5. **Analytics** — funnel + sales dashboard with date-range toggles.

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
│   ├── class-yaa-stripe.php      Payment gate STUB
│   ├── class-yaa-followups.php   Submit emails + partial-lead cron
│   ├── class-yaa-projects-admin.php  Branded Projects screen (funnel + form view)
│   ├── class-yaa-admin.php       Settings screen
│   └── class-yaa-log.php
└── assets/{css/archie.css, js/archie.js}
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
