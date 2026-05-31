# Hillcroft Gardens — AI Garden Design System (Build Brief)

**Version:** v2 (full scope) · **Status:** Spec locked for build — no code written yet.
This document is the complete build spec for the WordPress plugin. The client wants **v1 to
be the final version**, so everything below is in-scope for the first build (a short
"explicitly out of scope" list is at the end).

**Client:** Hillcroft Gardens (hillcroftgardens.co.uk) — garden design, Watford &
Hertfordshire
**Primary user:** Donna (designer) — runs consultations, drives the system
**End client:** Hillcroft's customers — book/pay for a consultation, receive the proposal,
pay through a milestone schedule
**Built by:** October Communications, as a self-contained WordPress plugin in the monorepo
**API accounts:** owned by Hillcroft (their own keys; October Comms does not handle billing)

> **Guiding principle:** AI does the grunt work — reading sketches, drafting visuals,
> pricing, assembling documents — so Donna spends her time on design and the client
> relationship. Every AI output is editable and overridable by Donna. The proposal reads as
> *hers*. **And the whole experience — backend included — must feel glossy and premium, never
> "back office."**

---

## 1. What This Product Is

A single, self-contained WordPress plugin that runs Hillcroft's entire client journey end to
end — **a fully closed loop, depending on no other plugins**:

> Lead capture & paid consultation booking → on-site capture (sketch/photos/address) →
> Claude reads & confirms the design → ideas dialogue → Gemini concept renders (iterate) →
> full render pack + seasonal film → pricing from an in-plugin plant database →
> interactive proposal in a client portal → contract e-sign + milestone payments via Stripe →
> print-ready plant book → aftercare & maintenance upsell.

Powered by the **Claude AI API** plus Gemini (images), Google Maps, Plant.id/Kindwise, GBIF
and Wikimedia. Marketing follow-ups, CRM and reporting are **built natively into this
plugin** — nothing is delegated to `oc-forms` or `october-outreach`.

---

## 2. The End-to-End Journey

### Stage 0 — Lead capture & consultation booking (public, on the website)
Front of the funnel, all native to the plugin. **All lead routes supported** (Hillcroft
hasn't launched yet, so we build them all):
- **Paid consultation booking** — the site's primary CTA is **"Book a consultation — £200."**
  A public booking page (date/time + details) takes a **£200 Stripe payment** and creates a
  Project in `lead` status. The **£200 is a separate, non-refundable service fee — it is NOT
  deducted** from any later design/build total (deliberate, so Donna's consultation isn't
  devalued). Booking uses the **native booking system** in §10a.
- **Free enquiry form** — lighter "get in touch" route → Project in `enquiry` status.
- **Manual entry** — Donna creates a Project herself.
- **Pre-visit questionnaire** — once booked, the client fills in budget range, style,
  must-haves, pets/children, allergies, so Donna arrives informed and the AI designs to
  budget from the start.

### Stage 1 — Capture (phone-first, offline-tolerant)
Donna uploads: **sketch(es)** (with hand-written dimensions — see below), **photos** of the
space, the **address** (satellite/aerial), and an optional **voice note** brief
(auto-transcribed). Photos can be tagged to a zone; existing plants auto-identified into a
**keep / remove** survey.

### Stage 2 — Claude reads & confirms the sketch + measurements
Claude (vision) interprets the sketch and **reads the hand-written dimensions off the paper**
(measurements are captured on the sketch, not drawn on a map — see §6), then asks
**clarifying questions** to confirm layout, zones and figures ("I read the main lawn as
11.5 m × 6.5 m and the border depth as 1 m — correct?"). Conversational confirmation loop;
Donna confirms/edits everything.

### Stage 3 — Design ideas dialogue
Donna describes plants, hard landscaping, materials, mood. Claude confirms understanding,
suggests options, applies **aspect/sun, soil and exposure** logic to flag unsuitable
choices, and assembles a structured, editable design brief. Budget-aware throughout.

### Stage 4 — Concept image (iterate)
The system composes a Gemini prompt → rough concept render, with **iteration buttons**
(regenerate / adjust / refine). Donna iterates until happy.

### Stage 5 — Render pack + seasonal film
On **Render**, the full visual set is produced async (see §7), including the **Remotion
seasonal film**.

### Stage 6 — Pricing
Priced from the **in-plugin plant database** (§5) + hard-landscaping + Donna's fees, with
area-driven quantities (§6). **Good / Better / Best** tiers and a **full milestone payment
schedule**.

### Stage 7 — Proposal: portal + contract + payments
Client gets an **email** → **interactive proposal in a client portal**: render gallery,
seasonal film, before/after sliders, planting plan, itemised costs. They can **comment /
request changes**, **e-sign the contract & T&Cs**, and **pay** on the embedded **milestone
schedule** via Stripe. Proposal has a **30-day expiry**. A downloadable PDF keepsake is also
produced.

### Stage 8 — Plant book (print-ready)
A **print-ready** PDF book (bleed/CMYK) of every plant — cover is the watercolour scheme,
one plant per page with photo/render + care notes + a mini "where it's planted" map + QR to
its portal care page. Designed to be **physically printed and delivered** to the client.

### Stage 9 — Aftercare
Post-install check-in, plant warranty tracking, and the **maintenance calendar** feeding a
**maintenance-contract offer** (recurring revenue).

---

## 3. Core Concepts / Data Model (draft)

- **Project** — one garden for one client. Status:
  `lead → enquiry → booked → capture → design → rendered → proposed → accepted → in_progress → complete`.
- **Client / CRM record** — contacts, addresses, project history, full **communications log**.
- **Asset** — uploaded file (sketch/photo) or generated image (render), typed by role; stored
  in the **WP media library** (unlimited storage available).
- **Brief** — Claude-assisted structured understanding (layout, zones, dimensions, ideas);
  fully editable.
- **Plant (catalogue)** — a row in the **in-plugin plant database** (§5), name-normalised via
  GBIF. Source of truth for pricing.
- **Project plant** — a plant placed in a project zone, with quantity (often derived from bed
  area × spacing).
- **Render** — generated image with a role (satellite / watercolour / plan / corner-N /
  season-X) + version history. Plus the **seasonal film** asset.
- **Proposal** — priced, presented design. Holds tier(s), **price snapshot** (§5), milestone
  schedule, deposit setting, portal token, expiry date, view/comment/accept/sign/payment
  status.
- **Payment** — a milestone within a proposal (deposit / interim / final), with Stripe state.
- **API usage log** — every external call: vendor, units, est. cost (£), project, timestamp →
  drives the cost banner (§4).
- **Audit log** — who changed what, plus AI prompts/outputs, per project.

---

## 4. Cost & Credits — Persistent Top-of-Screen Banner

**A persistent banner across the top of every plugin admin screen** — first thing Donna sees
on login, no page to go and check. Principle: **no surprises.**

- **Sticky status bar:** credits remaining (prepaid APIs) + spend this month, colour-coded
  🟢 healthy / 🟠 low or near soft-cap (→ one-click **Top up** link) / 🔴 out or over cap.
- When action is needed it **also** fires a site-wide WordPress **admin notice** (dismissible,
  reappears next login until resolved).
- Two widget types: **"credits remaining"** (prepaid, e.g. Plant.id, with 3-month expiry
  warning) and **"spend to date"** (metered: Claude, Gemini, Maps).
- Under the hood: every call logged; an editable **rates table in Settings** converts all to
  **£**; **per-project cost-to-produce** shown next to its sale price (margin always visible).
- **Optional soft monthly spend cap** — alert only, never a hard stop, so a live client render
  can't break mid-flow.

---

## 5. Plant Database & Pricing Engine

**Change from v1 thinking: there is no CSV upload as the primary path.** Donna maintains a
**plant catalogue *inside* the plugin** (a proper CRUD admin UI on the website). It is the
source of truth, **exportable to CSV** (and importable) for backup/bulk edits, but day-to-day
she just updates the database directly.

**Catalogue fields:** botanical name, common name, type
(tree/shrub/perennial/grass/bulb/climber/hedging/aquatic), pot size/grade, **unit cost,
markup, supplier, SKU, lead time, min order qty**, mature height/spread, **spacing (plants
per m²)**, sun/soil/hardiness, evergreen/deciduous, flowering months, **toxicity (pet/child
safe flags)**. Names normalised via **GBIF**; care/photos enriched via Plant.id + Wikimedia +
Claude (gaps flagged "AI-generated, verify").

**Pricing engine:**
- **Area-driven quantities** from confirmed measurements: plants from *plants-per-m²*; turf,
  paving, mulch (area × depth), topsoil by area/volume; edging/fencing by linear m.
- **Labour** (day rates × crew × estimated days), **wastage %**, **delivery / skip /
  machinery hire**, **contingency** line.
- **Per-category markup rules**; tidy rounding (no £4,237.91).
- **Good / Better / Best** tiers; **full milestone schedule**. A **default split is set in
  Settings** (default **50% deposit on signing / 25% on commencement / 25% on completion** —
  weighted to deposit because plants & materials are bought up front) and Donna can **adjust
  the numbers per project and save**. The **£200 consultation fee is separate** and never
  rolled into this schedule.
- **VAT** handling; metric units throughout; **£** everywhere.
- **Price-locking:** a proposal **snapshots its line items at creation** — re-editing the
  catalogue never changes an already-sent proposal. Combined with the **30-day expiry**, the
  client always pays exactly what they saw.
- **Internal margin view** (cost vs price vs profit) — never shown to the client.

---

## 6. Measurements

Measurements are **captured on the paper sketch** — Donna writes dimensions on her drawing
(e.g. lawn 11.5 m × 6.5 m, border depth 1 m, wall heights 0.75 m / 0.7 m, zone widths
2.5 m / 5.2 m / 2 m, plus notes like "full sun", "dry shade", "rustic path", "cast-iron
container / lavender"). Claude **reads the figures and annotations off the photographed
sketch** in Stage 2, presents them for confirmation, and feeds them to the pricing engine.
No draw-on-map tool needed; the hand sketch is the measurement source.

---

## 7. Visual Deliverables — The Render Pack + Film

A deliberate, bounded set (controls cost + consistency):

- **1 ×** Satellite-overlay masterplan (scheme on the aerial view)
- **1 ×** Watercolour of the sketch — the **hero / book cover** image
- **1 ×** Hand-drawn-feel "technical" plan (illustrative, *not* engineered)
- **3–4 ×** Corner / eye-level views (one per key zone)
- **Seasonal variants** (spring / summer / autumn / winter structure) of the hero views
- **Seasonal film** — a **Remotion** cinematic montage of the above (Ken Burns, season
  crossfades, 2.5D parallax, branded titles, music). Optional AI "living stills" upgrade.
- **Before/after sliders** — existing photo vs render of the same angle (portal).

≈ 6–8 core stills + seasonal variants + the film. **Draft (cheap/fast) vs final
(high-quality)** render modes keep iteration cheap. Live progress shown for async jobs; clear
retry state on failure.

**Disclaimers** on all renders/prices: *"Artistic impression — plants and finishes may vary"*
and *"Indicative, subject to final site survey / ground conditions,"* plus a plant-
substitution clause.

---

## 8. Client Portal, Contract & Milestone Payments

- **Tokenised portal link** in the email — unique, unguessable; no password (optional
  email-verify before pricing shows). Mobile-responsive, accessible.
- **Interactive proposal page** — render gallery, seasonal film, before/after sliders,
  planting plan, itemised costs, **Accept**, **e-sign contract & T&Cs**, and **pay** inline.
  This page *is* the proposal; the PDF is a keepsake.
- **Milestone payments** embedded via **Stripe** (deposit → interim → final). Deposit field is
  a **fixed £ or % toggle** per proposal (% auto-recalculates if the total changes before
  payment). Robust webhooks, idempotency, auto receipts, refund handling.
- **Change-requests:** client can comment / annotate renders → routed to Donna, proposal
  versioned (v1, v2…); client always sees the latest, Donna keeps the history.
- **Status tracking:** `sent → viewed → commented → accepted → signed → deposit_paid → …`.
  Donna notified on each. **30-day expiry** on every proposal.

---

## 9. The Plant Book (print-ready)

PDF designed for **physical print** (bleed + CMYK) and delivery to the client. Cover = the
watercolour scheme. One plant per page: photo/render + care notes + mini "where it's planted"
map + optional QR to the portal care page. Totals summary. With client **consent**, renders +
book double as Hillcroft marketing/portfolio content.

---

## 10. CRM, Follow-ups & Reporting (all native)

- **CRM-lite:** client records, project history, communications log.
- **Follow-up automation** (built in, not via `october-outreach`): e.g. proposal opened but
  not accepted in 7 days → nudge; consultation booked → reminder; aftercare check-ins.
- **Pipeline dashboard:** pipeline value, conversion rate, average project value, win/loss,
  revenue, **and API spend vs revenue**.
- **Templates** (editable, not hard-coded): proposal, email, T&Cs, plant-book.
- **Light roles/permissions** — single-user is fine, but we'll use WordPress capabilities so a
  second designer can be added without rework (low cost to include).

### 10a. Booking & Calendar (native, with Gmail sync)

Hillcroft has **no Google Workspace** — they use an **IMAP/SMTP email service**. So:

- **Native booking system** is the source of truth: Donna sets availability rules
  (working hours, slot length, buffers, blackout dates); the public booking page shows open
  slots, collects details, and takes the **£200 Stripe** consultation payment.
- **Two-way Google Calendar sync via OAuth** — the Google Calendar API **works with a personal
  Gmail account** (no Workspace needed). Donna connects her personal calendar once; her
  existing events **block out availability**, and new bookings are **written to her calendar**
  automatically.
- **Client gets an `.ics` invite**; reminders and confirmations are sent through the
  **existing IMAP/SMTP** service (also the channel for all proposal/follow-up email).
- **Fallback if she ever declines OAuth:** the plugin still works standalone and can publish a
  read-only **iCal feed** she subscribes to from any calendar app.

---

## 11. Design System — "glossy, even on the backend"

The plugin's admin must feel like the **website**, inside WordPress. **Keep the standard WP
left-hand menu** for navigation; restyle everything to the right of it. Premium and
user-friendly, never "back office."

- **Aesthetic:** dark, editorial, photographic; generous whitespace; large imagery; soft
  shadows and rounded cards ("glossy"); calm, confident.
- **Buttons:** **all pill-shaped**, everywhere.
- **Palette** (confirmed):
  - **Brand olive green `#494A20`** — primary brand colour / accent
  - Warm near-black / charcoal — primary dark / backgrounds (~`#1B1C18`, confirm)
  - Warm cream / paper — surfaces, and text/logo reversed on dark (~`#F2ECDD`, confirm)
- **Typography (confirmed):** **Cormorant Garamond** for headings (elegant high-contrast
  serif, with *italic* emphasis as on the site: "*designed by us.*"); **DM Sans** for body and
  tracked-out caps for labels/nav. Both are free Google Fonts — **bundle locally** so the
  admin, client portal *and* PDFs all share the type.
- **Logo:** "hillcroft gardens" lowercase serif wordmark, monochrome (black version on cream,
  cream/reverse on dark). Vector asset version-controlled at
  `docs/brand/hillcroft-logo-black.svg` (fully outlined — no embedded font).
- **Tone of copy:** "Straight-talking plant expertise. No hard sell, no guesswork." Carry this
  voice into system copy and proposals.

---

## 12. Architecture & Non-Functional

- **Self-contained WP plugin** in the monorepo; reuse Stripe patterns from `oc-ad-manager`,
  Claude + **Action Scheduler async jobs** from `october-outreach` (render packs, film and
  book generation run async with live progress).
- **Storage:** WP media library (unlimited).
- **Email:** all transactional mail (booking confirmations, proposals, follow-ups) sent via
  Hillcroft's existing **IMAP/SMTP** service — no Google Workspace, no new email provider.
- **Caching:** GBIF lookups, geocoding and plant data cached aggressively to cut API spend.
- **Resilience:** graceful API failure + retry; idempotent payments/webhooks.
- **Security/privacy:** secrets in settings/env; **GDPR** — consent capture, retention policy,
  delete-on-request; explicit **marketing-reuse consent** for client photos/renders.
- **Legal:** contract + T&Cs e-sign; render/price disclaimers; substitution clause.

---

## 13. Explicitly Out of Scope (for now)

- True volumetric **3D flythrough** (needs a modelled 3D scene).
- **AR** preview.
- Multi-tenant / multi-company (this is built for Hillcroft).

---

## 14. Decisions Resolved

- **Brand** — olive green `#494A20`; **Cormorant Garamond** (headings) + **DM Sans** (body).
- **Consultation fee** — £200 is **separate and non-refundable**, never deducted from the
  project total (so the consultation isn't devalued).
- **Milestone split** — editable default in Settings (**50% / 25% / 25%**), adjustable & saved
  per project.
- **Contract / T&Cs** — drafted by us as a template (Hillcroft has no solicitor); see
  `docs/HILLCROFT-TERMS-TEMPLATE.md`. **Must be reviewed by a qualified solicitor before use.**
- **Booking / calendar** — native booking system + two-way **Google Calendar sync via OAuth on
  a personal Gmail** account; emails via the existing **IMAP/SMTP** service (see §10a).

### Still to nail down later
- Exact charcoal/cream hex values (olive + fonts confirmed; the neutrals are approximate).
- Whether to add the optional AI "living stills" video upgrade in the first build.
