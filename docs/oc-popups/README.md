# October Popups

A lightweight WordPress popup plugin for **occasional** use — competitions,
seasonal offers, announcements — where the popup body is built with the site's
existing page builder (**WP Bakery** or **Elementor**).

- **Code:** `dev/oc-popups/` (WP plugin slug `october-popups`)
- **Docs:** `docs/oc-popups/` (this folder)
- **Releases:** tagged `ocpop-v<version>`, built by
  `.github/workflows/october-popups-release.yml`, installed via the plugin's
  built-in self-updater.

## Why build rather than repurpose

Off-the-shelf popup plugins (Popup Maker, etc.) ship their own content editor
and a lot of features we don't need. The one hard requirement here — *build the
popup in WP Bakery or Elementor* — is cleanest when the popup is a **custom post
type** (`ocpop_popup`) whose content those builders edit natively. This plugin
does exactly that and nothing more, so it stays small and fits the monorepo's
two-folder rule + self-updater/release pipeline.

## How it works

| Concern | Where it lives |
|---------|----------------|
| Popup **body** (images, text, buttons) | The post content — edited by WP Bakery / Elementor |
| **Triggers, frequency, schedule, targeting, appearance** | The "Popup Settings" meta box (`_ocpop_settings`) |
| **Rendering** on the frontend | `OCPOP_Builders::render_content()` — Elementor via its render API, WP Bakery/Gutenberg/classic via `the_content` filters |
| **Trigger engine** | `assets/js/popups.js` (reads config from a JSON block in the footer) |
| **Impression / CTA tracking** | REST `october-popups/v1/track` → post-meta counters |

### File map

```
dev/oc-popups/
  october-popups.php            Bootstrap: constants, requires, activation, boot
  includes/
    class-ocpop-cpt.php          CPT registration + admin list columns
    class-ocpop-meta.php         Popup Settings meta box + sanitisation
    class-ocpop-builders.php     WP Bakery / Elementor enablement + rendering
    class-ocpop-frontend.php     Page matching, enqueue, footer markup, shortcode
    class-ocpop-analytics.php    REST tracking endpoint
    class-ocpop-settings.php     Settings screen (updater token/repo)
    class-ocpop-updater.php      Self-updater (private-repo release zips)
  admin/                         Meta-box view, admin CSS/JS
  assets/                        Frontend CSS/JS
  bin/build-zip.sh               Staged zip builder
  readme.txt                     WP.org-format manifest (parsed for version)
  uninstall.php                  Cleanup on delete
```

## Triggers

`load`, `delay`, `scroll`, `exit` (desktop), `idle`, `click` (CSS selector),
and `manual` (opened only via `.ocpop-open-<ID>` or the
`[october_popup id="…"]` shortcode).

## Frequency & scheduling

Frequency caps (`always` / `session` / `days` / `once`) are enforced in the
browser via `localStorage`/`sessionStorage`, so they survive full-page caching.
Optional `start_date` / `end_date` (site timezone, end-of-day inclusive) gate
the popup server-side — set both for a competition window.

## Enabling the builder on the CPT (one-time)

- **Elementor:** the CPT is auto-added to `elementor_cpt_support`. If missing,
  enable under *Elementor → Settings → General → Post Types*.
- **WP Bakery:** tick "Popup" under *WPBakery → Role Manager → Post types*.

## Releasing

1. Bump `Version:` in `october-popups.php` (and `Stable tag:` in `readme.txt`).
2. Merge to `main`. The Action reads the header, builds
   `october-popups-<version>.zip`, and creates release `ocpop-v<version>`.
3. On the live site, **Popups → Settings** holds the GitHub token; the update
   then appears under Dashboard → Updates.

## Status

v1.0.0 — initial build. Possible follow-ups: A/B variants, richer analytics
dashboard, form-submission conversion tracking, import/export of popup configs.
