# Your Architect — WordPress theme

A standalone WordPress theme that wraps the [Your Architect v3 site](./README.md) into an
installable theme, including the two-panel conversational **project builder** and a project
records back end.

> **Naming:** brand is **Your Architect** (yourarchitect.uk); the onboarding assistant is **Archie**. The theme display name is "Your Architect", but the folder/slug and code identifiers keep `archlie` (see the README naming note).

- **Code:** [`dev/archlie/theme/archlie/`](../../dev/archlie/theme/archlie/)
- **Slug / folder:** `archlie` · **Requires:** WordPress 6.0+, PHP 7.4+

> **Context:** Brief v3 §11 specifies the production Your Architect as a **React app on Hetzner**,
> not WordPress. This theme is a WordPress interpretation of the same design for a quick
> launch / review. The marketing site and the conversational builder work in WordPress; the
> AI onboarding is still the scripted front-end mock (a live Claude call + Postgres/Stripe
> belong to the React build). Use it to get Your Architect in front of people fast, or as the
> reference the React build follows.

## Install

```bash
# From dev/archlie/theme/
zip -r archlie.zip archlie -x '*.DS_Store'
# WordPress → Appearance → Themes → Add New → Upload Theme → Activate
```

On activation the theme **auto-creates a "Start your project" page** (slug `start`) using the
*Project Builder* template, and the homepage renders automatically via `front-page.php`. No
other setup required.

## What it does beyond the static site

| Feature | Where | Notes |
|---|---|---|
| **Prices in PHP** | `inc/pricing.php` | One `archlie_pricing_table()` localised to the front-end as `window.ARCHLIE_WP`. The homepage table and the builder both read it — set prices in one place. Filter: `archlie_pricing_table`. |
| **Two-panel builder** | `template-project-builder.php` + `assets/js/onboarding.js` | The full conversational flow with live package + running total, voice, photo, redirect logic and localStorage resume — rendered as a full-screen WordPress page template. |
| **Project records** | `inc/intake.php` | The builder's **Save & submit** posts to `admin-ajax` (nonce-protected) and opens an `archlie_project` post storing the full package/state, emails the studio + client, and shows a read-only record in wp-admin (**Your Architect Projects**). |
| **Registration shown** | `inc/customizer.php` + templates | ARB registration no. and company no. are Customizer fields, shown on the site and footer per brief §2. |
| **Editable hero + email** | `inc/customizer.php` | Hero eyebrow/heading/intro and the notification email. Custom logo + nav menus supported. |
| **Extension hook** | `inc/intake.php` | `do_action( 'archlie_project_created', $post_id, $payload )` — the seam for Stripe, the portal, and follow-ups. |

## File map

```
archlie/
├── style.css                     Theme header
├── functions.php                 Setup, enqueue + localize pricing, menus, auto-create builder page
├── header.php / footer.php       Site chrome (footer carries the trading-name + registration line)
├── front-page.php                Marketing homepage
├── template-project-builder.php  Full-screen two-panel builder (Template Name: Project Builder)
├── index.php / page.php          Fallbacks
├── screenshot.png                Theme-selector preview (1200×900)
├── inc/
│   ├── pricing.php               Pricing model (single source of truth)
│   ├── intake.php                archlie_project CPT + AJAX submit + admin record
│   └── customizer.php            Hero copy, ARB/company numbers, notify email
└── assets/
    ├── css/theme.css             House style
    ├── css/onboarding.css        Two-panel builder styles (loaded only on the builder page)
    └── js/{pricing,app,onboarding}.js
```

## Pricing (confirmed indicative — Brief v3 §5)

| Service | Band A | Band B | Band C |
|---|---|---|---|
| Planning application | £950 | £1,350 | £1,850 |
| Building control drawings | £850 | £1,200 | £1,650 |
| Permitted development | £750 | £950 | £1,250 |
| Listed building consent | £1,200 | £1,600 | £2,200 |
| Concept design (add-on) | £400 | £600 | £900 |

Survey added on top at banded rates (London rate where applicable). Edit in
`inc/pricing.php`. Final figures set by Tiam before launch.

## Still TODO for the full build (documented seams)

Building on the `archlie_project` record this theme creates:

- **Live AI onboarding** — replace the scripted flow with a server-side Claude call emitting
  the same package patches (brief §6). WordPress can do this via an admin-ajax endpoint that
  proxies the Anthropic API; the React build does it natively.
- **Payment gate + watermarked preview**, **Stripe Connect** consultant payouts, the
  **client portal**, and the **partial-submission follow-up** email.
- **Anonymous-from-first-message** persistence (brief §6): here the record opens at submit;
  full anonymous Postgres persistence is a React/DB concern.

## Setup notes

- Ensure WordPress can send email (the builder emails the studio + client on submit) — an
  SMTP plugin is the usual fix on hosts that don't send reliably.
- Set the real **ARB registration** and **company** numbers in **Customizer → Your Architect**
  (they show as `[to confirm]` until you do).

## Verification

Templates rendered through a WordPress-function stub harness and screenshotted: the homepage
is pixel-identical to the static site (prices from PHP), and the builder page runs the full
conversation with the live quote-validity date. All PHP passes `php -l`.

---
_Prepared by October Communications._
