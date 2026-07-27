# Architects Direct — WordPress theme

A standalone WordPress theme that wraps the [static Architects Direct site](./README.md)
into an installable, editable theme, and seeds the Phase 1 backend.

- **Code:** [`dev/architects-direct/theme/architects-direct/`](../../dev/architects-direct/theme/architects-direct/)
- **Theme slug / folder:** `architects-direct`
- **Requires:** WordPress 6.0+, PHP 7.4+

## Install

The theme folder *is* the installable theme (folder name = slug). Either:

```bash
# From dev/architects-direct/theme/
zip -r architects-direct.zip architects-direct \
  -x '*.DS_Store'
# then Appearance → Themes → Add New → Upload Theme → activate
```

…or copy the `architects-direct/` folder straight into `wp-content/themes/` and activate.

The landing page renders automatically as the site's front page (via `front-page.php`)
— no page setup or shortcode required.

## What it does beyond the static site

This isn't just the HTML renamed. The port adds real WordPress plumbing:

| Feature | Where | Notes |
|---------|-------|-------|
| **Pricing in PHP** | `inc/pricing.php` | One `ad_pricing_table()` is the single source of truth. It's localised to the calculator JS, so you set prices in **one** place. Filterable via `ad_pricing_table`. |
| **Instant calculator** | `front-page.php` + `assets/js/app.js` | Service radios and service cards are generated from the pricing table, so they can't drift from the prices. |
| **Tiam redirect logic** | `assets/js/app.js` | Over-150m² / listed / ongoing-management → "Request a consultation" panel (brief §8). Threshold band is data (`redirect_over_band`). |
| **Intake → project account** | `inc/intake.php` | The form posts to `admin-ajax.php` (nonce-protected). On submit it opens an `ad_project` custom post (the "project account", brief §3.4), stores the brief as meta, emails the studio + an auto-reply to the client, and returns JSON. |
| **Admin view** | `inc/intake.php` | `AD Projects` menu in wp-admin; each project shows a read-only "Project brief" meta box. |
| **Editable content** | `inc/customizer.php` | Customizer section for the hero eyebrow / heading / intro and the notification email. Custom logo + nav menus supported. |
| **Extension hook** | `inc/intake.php` | `do_action( 'ad_project_created', $post_id, $meta )` — the seam for payments, follow-up scheduling, or CRM sync. |

## File map

```
theme/architects-direct/
├── style.css              Theme header (WordPress requirement)
├── functions.php          Setup, asset enqueue + wp_localize_script, menus, logo helper
├── header.php             <head>, wp_head, site header + nav
├── footer.php             Footer + wp_footer
├── front-page.php         The full landing page (hero → CTA), driven by the pricing table
├── index.php              Fallback for archives/blog/search
├── page.php               Single page (Terms, Privacy, …)
├── screenshot.png         Theme-selector preview (1200×900)
├── inc/
│   ├── pricing.php        Pricing table + formatting helpers
│   ├── intake.php         ad_project CPT + AJAX intake handler + admin meta box
│   └── customizer.php     Hero copy + notification email settings
└── assets/
    ├── css/theme.css      House style (same design as the static site)
    └── js/app.js          Calculator + AJAX intake (falls back to a static confirm if opened without WordPress)
```

## Pricing (indicative — set by Tiam before launch)

Held in `inc/pricing.php`. **Placeholder figures for demonstration** (brief §3):

| Service | Band A (≤50m²) | Band B (50–100m²) | Band C (100–150m²) |
|---------|----------------|-------------------|--------------------|
| Planning application | £1,200 | £1,800 | £2,400 |
| Building control / regs | £900 | £1,400 | £1,900 |
| Permitted development | £750 | £1,100 | £1,500 |
| Tender drawings | £1,400 | £2,000 | £2,800 |

To change them, edit the array in `inc/pricing.php` (or hook `ad_pricing_table` from a
site plugin). Nothing else hard-codes a price.

## Still TODO for full Phase 1 (documented seams)

The theme opens the project account and captures the brief; these remaining Phase 1
items build on top of that record and are the natural next pass:

- **Drawing upload + watermarked preview** delivery to the project portal.
- **Payment gate** before full drawing release (e.g. WooCommerce/Stripe, hung off the
  `ad_project` post).
- **Partial-submission follow-up email** — a scheduled job that chases the missing
  fields on any `ad_project` still incomplete (brief §3.4). The account + captured
  fields this theme creates are exactly what that job acts on.

Phase 2 (AI-assisted intake, automatic consultant revenue distribution, complexity
scoring) extends the redirect data and the `ad_project_created` hook.

## Local verification

Templates were rendered with a WordPress-function stub harness and screenshotted at
desktop/mobile — output is pixel-identical to the merged static site, with prices,
nav and footer all server-rendered. All PHP passes `php -l`.

---
_Prepared by October Communications._
