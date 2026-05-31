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

## ⏳ Next

1. **Proposals + client portal + milestone payments** (turn a chosen quote into a sent, payable
   proposal): interactive proposal page, e-sign, deposit/milestone Stripe payments, PDF keepsake.
2. The full **render pack** (satellite masterplan, watercolour, hand-drawn plan, corner views,
   seasonal variants) — the harder cross-angle-consistency work.
3. Plant book PDF + seasonal film.
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
