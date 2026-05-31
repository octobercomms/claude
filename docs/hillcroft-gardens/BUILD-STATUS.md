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

## ⏳ Next (each its own PR)

1. **Paid £200 consultation booking** + embedded Stripe (0.4.0).
2. Native **booking calendar** with two-way Google Calendar (personal Gmail) OAuth sync.
3. Capture: uploads (sketch/photos/address), voice-note transcription.
4. **Claude** integration: read sketch + hand-written measurements, clarifying-questions loop.
5. **Gemini** concept renders + iteration; render pack; before/after sliders.
6. **Remotion** seasonal film (+ optional AI living-stills).
7. Pricing engine (area-driven quantities, price-locking snapshots, Good/Better/Best, milestones).
8. Client portal: interactive proposal, e-sign, **milestone payments**, 30-day expiry, comments.
9. PDFs: proposal keepsake + **print-ready plant book**.
10. Enrichment: GBIF normalisation, Plant.id ID/care, Wikimedia photos.
11. Follow-up automation + pipeline/reporting dashboard.

## Known foundation TODOs

- Self-host the brand fonts (currently loaded from Google Fonts in admin).
- Consider encrypting stored secrets (currently masked plaintext in `wp_options`).
- Add CSV import/export for the catalogue.
