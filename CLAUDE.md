# Repository organisation

This repo holds multiple apps/products built for October. Keep it tidy by
following the conventions below. **These rules apply to every app, current and
future — all Claude agents working in this repo must follow them.**

## The two-folder rule

| What | Where |
|------|-------|
| **All code** for any app | `dev/<app-name>/` |
| **All docs** for any app (briefs, specs, status notes, READMEs, API docs, TODOs) | `docs/<app-name>/` |
| Build artefacts / release zips | `releases/` (and `*.zip` is gitignored) |
| Shared brand assets (logos, etc.) | `docs/brand/` |
| Marketing content / blog posts | `docs/blog/` |

Each app's code folder under `dev/` should have a matching docs folder under
`docs/` with the **same name**. Code folders contain code only; documentation
lives in `docs/`.

### Adding a new app

1. Create `dev/<app-name>/` for the code.
2. Create `docs/<app-name>/` for its brief, README, API docs, status notes, etc.
3. Do not leave `.md` docs inside the code folder.

## Exceptions (functional files that stay with the code)

These are not prose docs — they are manifests/config the toolchain reads, so
they live **with the code**, not in `docs/`:

- `readme.txt` in a WordPress plugin (WP.org parses it for version / stable tag)
- `package.json`, `composer.json`, `.gitignore`, config files, deploy scripts

## Current apps

`dev/` contains: `ada-checker`, `architourian-pdf`, `brevo-widgets`,
`hillcroft-gardens`, `landing-pages`, `loom-tutorial-player`, `meta-ads`,
`oc-ad-manager`, `oc-forms`, `october-admin-theme`, `october-event-tickets`,
`october-outreach`, `platform`, `ticker-link`, `tour-dates-shortcode`,
`video`, `webp-image-optimizer`, `woo-bulk-editor`, `wordpress-lead-capture`.

The **Hillcroft Garden Designer** WordPress plugin lives in `dev/hillcroft-gardens`
(WP plugin slug `hillcroft-garden-designer`); its docs are in `docs/hillcroft-gardens`.
Releases are tagged `hgd-v<version>` and built by a GitHub Action into a release
zip that the plugin's built-in self-updater installs.

**nvelope.co** is the product name for the October Performance Marketing
Platform; its code spans `dev/platform` (backend + frontend) and `dev/meta-ads`
(Meta Ads API integration). Its strategy/marketing docs live in `docs/nvelope/`.
