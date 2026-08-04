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
**recomputes the whole package** (`YAA_Pricing`), and returns `{ message, package }`.
Archie never states a price — the panel does. A project record is created from the
first message (cookie-tied `yaa_project` CPT), so a returning visitor resumes.

## What's built vs TODO

**Working:** the Claude turn (tool-use field extraction, scoped system prompt),
server-side pricing + package builder, project records + cookie session, the REST
API (`start`/`message`/`remove`/`submit`/`reset`), the `[archie]` shortcode +
Elementor widget with self-contained (theme-proof) styling, **encrypted** API/Stripe
keys, per-session **rate limiting** + a **daily token cap**, admin settings, and a
follow-up cron.

**Marked TODO (model on Hillcroft):**
- **Stripe** payment gate (`YAA_Stripe::checkout_url`) + Connect payouts + webhook.
- **Client portal / watermarked preview** + full-file release on payment.
- **Live Historic England API** (`YAA_Historic_England::api_lookup`) — a heuristic
  fallback ships; flip `historic_api_on` once wired.

## File map

```
your-architect-archie/
├── your-architect-archie.php     Bootstrap (constants, requires, activation)
├── includes/
│   ├── class-yaa-settings.php    Options (secrets encrypted via crypto)
│   ├── class-yaa-crypto.php      AES-256-CBC + HMAC at rest
│   ├── class-yaa-rate-limit.php  Per-session throttle + daily token cap
│   ├── class-yaa-pricing.php     Pricing model + server-side package builder
│   ├── class-yaa-project.php     yaa_project CPT + cookie session + record
│   ├── class-yaa-claude.php      Anthropic Messages API wrapper
│   ├── class-yaa-archie.php      System prompt, set_fields tool, turn()
│   ├── class-yaa-historic-england.php  Listed/London (heuristic + API hook)
│   ├── class-yaa-rest.php        yaa/v1 endpoints (nonce + rate-limited)
│   ├── class-yaa-shortcode.php   [archie] + assets + Elementor registration
│   ├── class-yaa-elementor-widget.php  "Archie" widget
│   ├── class-yaa-stripe.php      Payment gate STUB
│   ├── class-yaa-followups.php   Submit emails + partial-lead cron
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
