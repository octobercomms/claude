# October Proposals — build status

**Plugin code:** `dev/oc-proposals/` · **Current version:** 0.7.0 · **Status:** feature-complete
across the planned scope (PHP lints clean throughout). Built on PR **#710** as a rolling
branch — one commit per phase.

## Install once, update forever
- Built-in **self-updater** (`OCP_Updater`, `ocp-v` tag prefix) surfaces new releases on the
  WordPress Updates screen and installs them in place — no reinstall.
- A GitHub Action (`.github/workflows/oc-proposals-release.yml`) reads the header version and,
  on merge to `main`, builds the zip + cuts the tag/release itself.
- Add a fine-grained GitHub token (Contents: read) under **Proposals → Settings** to enable.

## What's built (by phase)

| Phase | Delivered |
|-------|-----------|
| **1 — Foundation** | Main file, full DB schema (13 tables), activation + in-place schema upgrade, OMI-tokened Settings, admin shell, updater, release Action, build-zip, readme, uninstall. |
| **2 — Library + CRM** | Generic CRUD repo; library (case studies w/ sector tags, testimonials, services, awards, showcase clients) via a registry-driven admin; CRM pipeline board + lead edit + Sales-Leads-Tracker CSV import; proposal-type presets. |
| **3 — Wizard** | `OCP_Proposal` model (token, lifecycle, sections, line items, currency/VAT-aware totals); stepped wizard (details → content → proof → pricing → publish). |
| **4 — Portal + e-sign** | Standalone OMI-styled token portal (`?ocp_proposal=`), Loom embeds, animated Plan of Work, view tracking; versioned Terms; accept & e-sign with audit trail + emailed record. |
| **5 — PDF** | Server-side mPDF, mPDF-safe template, **A4 landscape / US Letter landscape**, token download + email attachment; font pruning in build. |
| **6 — Payments + pause** | Stripe Checkout (one-off/project) + GoCardless Direct Debit (recurring) with webhooks; client-controlled pause with the 14-day-notice logic. |
| **7 — Analytics + Claude + builder** | First-party analytics screen (+ MS Clarity); `OCP_Claude` (re-angle, case-study drafting, band-clamped pricing, engagement report); DataForSEO diagnostics; public `[oc_proposal_builder]` with options-first ranges + scoped agent behind Turnstile/email/rate-limit/budget-cap. |

## Setup checklist (per site)
1. Install the plugin (or let the self-updater pull a release).
2. **Settings:** brand tokens (default OMI), company/legal, default currency, GitHub token,
   and any of: Claude key, Stripe, GoCardless, Clarity, DataForSEO, Turnstile.
3. **Terms:** paste the October T&Cs (versioned).
4. **Library:** add case studies / testimonials / services / clients (or draft case studies
   from uploads with Claude).
5. **Pipeline:** import the Sales Leads Tracker CSV.
6. Create a proposal in the wizard; publish; share the private link; client signs + pays.
7. Add `[oc_proposal_builder]` to a public page for self-serve indicative proposals.

## Notes / follow-ups
- **Brand font:** drop `brand-regular.ttf` / `brand-bold.ttf` into `assets/fonts/` to embed
  Brockmann (or a licensed near-match) in the PDF; confirm the licence covers PDF embedding.
- **mPDF/Stripe/GoCardless/Claude/DataForSEO** all degrade gracefully when keys/vendor are
  absent, so the plugin installs and runs before every integration is configured.
- **OMI Tier-2 diagnostics** (connected-client metrics) await a small OMI read API; Tier-1
  (DataForSEO) works today.
