# Hillcroft Gardens — AI Garden Design System (Build Brief)

**Status:** Living spec — shaping stage. No code written yet. This document captures every
decision made so far and the open questions still to resolve, so it can become the build
spec for the WordPress plugin.

**Client:** Hillcroft Gardens — a garden design company
**Primary user:** Donna (designer) — runs consultations, drives the system
**End client:** Hillcroft's prospective customers — receive the proposal and pay the deposit
**Built by:** October Communications, as a WordPress plugin in the existing monorepo
(alongside `october-outreach`, `oc-ad-manager`, `oc-forms`)

---

## 1. What This Product Is

A backend system, delivered as a WordPress plugin, that turns the rough output of an
on-site garden consultation (sketches, photos, an address) into a polished, priced,
visualised design proposal — with the client able to review it interactively and pay a
deposit online.

It is powered by the **Claude AI API** (reading, dialogue, copywriting) plus a set of
supporting APIs (image generation, mapping, plant data). The guiding principle:

> **AI does the grunt work — reading sketches, drafting visuals, pricing, assembling
> documents — so Donna spends her time on design and the client relationship, not admin.
> Every AI output is editable and overridable by Donna. The proposal reads as *hers*.**

---

## 2. The End-to-End Journey

### Stage 1 — Capture (phone-first)
Donna, on-site or just after, uploads:
- **Sketch(es)** of the proposed garden
- **Photos** of the existing space
- **Address** (for satellite / aerial view)
- Optional **voice note** describing the brief — transcribed automatically into starting notes

### Stage 2 — Claude reads & confirms the sketch
Claude (vision) interprets the sketch and photos and **asks clarifying questions** to make
sure it has read the layout correctly ("I can see a patio bottom-left and a curved border —
is that right?"). This is a *conversational confirmation loop*, not measurement — real
dimensions come from Donna confirming. Existing plants in photos can be auto-identified
(see Plant.id below) into a **keep / remove** survey.

### Stage 3 — Design ideas dialogue
Donna describes her ideas: plants she's considering, hard landscaping, materials, mood.
Claude confirms understanding, can suggest options, flags issues (e.g. aspect/sun — see
value-adds), and assembles a structured design brief. Donna edits freely.

### Stage 4 — Concept image (iterate)
The system composes a prompt for **Google Gemini image generation** to produce a rough
concept render, with **iteration buttons** (regenerate, adjust, refine). Donna iterates
until happy. *Note: cross-angle consistency is the hard part — see §7.*

### Stage 5 — Render pack
On **Render**, the system produces the full visual set (see §7) — satellite masterplan,
watercolour hero, hand-drawn plan, and corner views, with optional seasonal variants.

### Stage 6 — Pricing
Using Donna's **plant & price CSV** (the source of truth) plus hard-landscaping costs and
**her fees**, the system prices the whole garden. Supports **Good / Better / Best** tiers
and optional **phasing** (Phase 1 / Phase 2).

### Stage 7 — Proposal: portal + PDF + deposit
The client receives an **email** linking to an **interactive proposal in a client portal**
(see §9). They review renders, planting plan and itemised costs, **accept**, and **pay a
deposit** via embedded Stripe — all on one page. A downloadable PDF keepsake is also
produced.

### Stage 8 — Plant book (delight)
A beautifully designed **PDF book** of every plant in the garden — cover is a version of the
scheme (the watercolour), one plant per page with photo/render and care notes. Optional QR
per plant linking to its care page in the portal.

---

## 3. Core Concepts / Data Model (draft)

- **Project** — one garden for one client. Holds address, status, all uploads, the brief,
  renders, pricing, proposal. Status: `capture → design → rendered → proposed → accepted → deposit_paid`.
- **Asset** — an uploaded file (sketch, photo) or generated image (render), typed by role.
- **Brief** — the structured, Claude-assisted understanding of the garden + ideas; editable.
- **Plant (catalogue)** — a row from Donna's CSV: name, type, unit price, supplier, etc.
  The canonical name is normalised via GBIF. Source of truth for pricing.
- **Project plant** — a plant placed in a specific project, with quantity → drives pricing.
- **Render** — a generated image with a role (satellite / watercolour / plan / corner-N /
  season-X) and version history.
- **Proposal** — the priced, presented design. Holds tier(s), deposit setting, portal token,
  view/accept/payment status.
- **API usage log** — every external API call: vendor, units, estimated cost (£), project,
  timestamp. Drives the cost dashboard (§6).

---

## 4. Integrations — Pay-Per-Use API Stack

**Decision: every external cost is free or pay-per-use. No monthly subscriptions.** This
makes the entire API bill a **cost-per-proposal** that scales with actual jobs.

| API | Role | Billing | Notes |
|---|---|---|---|
| **Claude API** | Read sketches/photos, run the clarifying-questions dialogue, write care notes & book/proposal copy, fill plant-data gaps | Pay-per-token | Already used in `october-outreach`. Gap-filled care notes flagged "AI-generated, verify". |
| **Google Gemini (image gen)** | Concept renders + the render pack | Pay-per-image | Cross-angle consistency managed via reference-image conditioning + locked descriptions. |
| **Google Maps Platform** | Satellite still + Aerial View; address → orientation/aspect | Pay-per-request | Static Maps for the satellite overlay; Aerial View for flyover angle. |
| **Plant.id / Kindwise** | Identify existing plants from site photos; care + health/disease data | **Pay-per-credit** (€0.05→€0.01 at volume); prepaid **or** retroactive monthly billing | 100 free credits to start. `Search/Detail` = 0.5 credit. **Default to retroactive billing** so there's nothing to run out of. |
| **GBIF Species API** | Normalise every plant name to a canonical botanical ID / resolve synonyms | **Free** | Rock-solid taxonomy backbone; ties CSV + Plant.id + Claude names together so nothing is double-counted. |
| **Wikimedia Commons / Wikidata** | Licensed plant photography for the book | **Free** | Keyed off the canonical scientific name. |
| **Stripe** | Deposit payment, embedded in the portal | Per-transaction | Reuse the integration from `oc-ad-manager`. |

**Pricing data note:** *No API provides UK trade prices.* **Donna's CSV is the source of
truth for plants-she-uses and pricing.** The APIs are an enrichment layer around it — if any
enrichment API dies (as **Trefle** did — abandoned, do not use), pricing and proposals keep
working; only a nice-to-have is lost.

*Rejected: Perenual (subscription-only, against the pay-per-use preference); Trefle
(abandoned); Permapeople (commercial access requires a deal, ornamental coverage weak).*

---

## 5. Pricing Engine

- Driven by **Donna's CSV** (re-uploadable regularly), holding UK plant prices + suppliers.
- Adds **hard-landscaping** line items and **Donna's design/build fees**.
- Produces **Good / Better / Best** tiers from the same scheme.
- Supports **phasing** so large gardens can be quoted in stages.
- Every project shows its **API cost-to-produce** next to its sale price, so margin is
  always visible.

---

## 6. Cost & Credits Dashboard — Persistent Top-of-Screen Banner

**Decision: a persistent banner across the top of every plugin admin screen**, so it's the
first thing Donna sees on login — no page to go and check. Principle: **no surprises.**

- **Sticky status bar** showing at a glance: **credits remaining** (prepaid APIs) +
  **spend this month**, colour-coded:
  - 🟢 **Green** — healthy, stays small and quiet
  - 🟠 **Amber** — running low / approaching soft cap → one-click **Top up** link appears
  - 🔴 **Red** — out of credits / over cap
- When action is genuinely needed, it **also** fires a standard WordPress **admin notice**
  site-wide (dismissible, but reappears next login until resolved).
- **Two widget types**, because APIs bill differently:
  - **"Credits remaining"** — for prepaid credit APIs (Plant.id if prepaid). Shows balance
    and **3-month expiry** warning.
  - **"Spend to date"** — for metered APIs (Claude, Gemini, Maps). No "credits" concept;
    shows accrued spend this month and per project.
- **Under the hood:** every API call logged (vendor, units, est. cost, project, timestamp);
  a **rates table in Settings** (editable when vendors change prices) converts everything to
  **£**.
- **Optional soft monthly spend cap** — a safety-net alert if total spend crosses a figure
  Donna sets. **Soft only** (alert, not hard stop) so a live client render never breaks
  mid-flow.

---

## 7. Visual Deliverables — The Render Pack

A deliberate, bounded set (controls cost + consistency rather than "lots of angles"):

- **1 ×** Satellite-overlay masterplan (scheme dropped onto the aerial view)
- **1 ×** Watercolour of the sketch — the **hero / book cover** image
- **1 ×** Hand-drawn-feel "technical" plan (illustrative, *not* engineered — per the brief)
- **3–4 ×** Corner / eye-level views (one per key zone: patio, main border, focal point, seating)
- **+ optional seasonal variants** (spring / summer / autumn / winter structure) of the hero views

≈ **6–8 core images** + seasonal variants on demand. A **draft (cheap/fast) vs final
(high-quality)** render distinction keeps iteration cheap.

**Known limitation:** keeping the *same* garden identical across every angle is genuinely
hard with current image models. Expect "same scheme, artistic interpretations." Manage with
reference-image conditioning and set expectations with the client.

---

## 8. Client Portal, Proposal & Deposit

- **Tokenised portal link** in the email — unique, unguessable URL; no password for the
  client (optionally email-verify before showing pricing). Low friction is the point.
- **Interactive proposal page** — render gallery (incl. seasonal/angle views), planting
  plan, itemised cost breakdown, **Accept + Pay** inline. *This page is the proposal;* the
  PDF is a downloadable keepsake.
- **Embedded Stripe** deposit payment on the same page (reuse `oc-ad-manager` integration) —
  one click, no redirect.
- **Deposit field (backend):** **toggle — fixed £ *or* % of total**, Donna's choice per
  proposal. If %, the amount auto-recalculates if the garden total changes before payment.
- **Status tracking:** `draft → sent → viewed → accepted → deposit_paid`. Donna is notified
  the moment a deposit lands.

---

## 9. The Plant Book

- PDF, beautifully designed; **cover = the watercolour scheme**.
- **One plant per page**: photo or render + care notes (from Plant.id / Claude / Wikimedia).
- Optional **QR per plant** → its care page in the portal.
- With client permission, renders + book double as **marketing content** for Hillcroft's
  portfolio / social — the system quietly feeds their pipeline.

---

## 10. Value-Add Features (agreed direction)

1. **Seasonal renders** — show the scheme through the year (biggest differentiator).
2. **Aspect & sun/shade analysis** from address + satellite — flags unsuitable plant
   placements; makes the AI feel like a plantsperson, not a renderer.
3. **Auto maintenance calendar** per plant → natural **upsell to a paid maintenance contract**
   (recurring revenue).
4. **Good / Better / Best** budget tiers.
5. **Pollinator / biodiversity score** for the planting plan — on-brand marketing line.
6. **Phasing** for large projects.

---

## 11. Architecture Notes

- **WordPress plugin** in the October Comms monorepo. Follow existing conventions:
  `oc-hillcroft.php` entry, `admin/` (views, css, js) + `includes/` (classes), prefixed.
- **Reuse:** Stripe (`oc-ad-manager`), Claude integration + **Action Scheduler async jobs**
  (`october-outreach`) — render packs and book generation are heavy/slow and must run async.
- **Human approval gate** between every stage; full **version history**; nothing auto-sends
  to a client.
- **Secrets** via env/settings (Claude, Gemini, Google Maps, Plant.id, Stripe keys).

---

## 12. Open Questions / To Confirm

- **Hillcroft brand** — colours, logo, fonts for portal + PDFs (needed for design work).
- **Plant.id billing mode** — confirm **retroactive** (recommended) vs prepaid credits.
- **Soft spend cap** — include the optional safety-net alert? (recommended yes.)
- **Gemini vs alternatives** — confirm Gemini for image gen, or evaluate others on
  consistency/cost.
- **e-signature** on acceptance — needed, or is "Accept + pay deposit" sufficient?
- **VAT / currency** handling on pricing and Stripe.
- **Who tops up / owns the API accounts** — Hillcroft's own keys, or October Comms-managed?
- **Render pack final count** — lock the number of corner views and which seasons.
