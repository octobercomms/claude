# Your Architect — v3 site + design comparison

> **Naming:** the product is **Your Architect** (domain **yourarchitect.uk**), and the
> AI assistant that runs the onboarding conversation is **Archie**. This was briefly
> named "Archlie" during development — the visible brand is now Your Architect, but the
> internal code identifiers (the `dev/archlie/` folder, the theme slug `archlie`, the
> `archlie_` PHP prefixes, `window.ARCHLIE`) intentionally keep the `archlie` name so
> nothing breaks. Renaming those too is a separate, larger change if ever wanted.

**Your Architect** is the v3 evolution of the product previously called *Architects
Direct* (brief v3, July 2026). Same core idea — fixed-price residential architectural
drawings that redirect larger jobs to Tiam — but rebranded, repriced, and built around a
conversational **AI onboarding** flow (the assistant is **Archie**) instead of a form.

- **Code:** [`dev/archlie/`](../../dev/archlie/)
- **Current design brief:** [`design-brief.md`](./design-brief.md) (Aug 2026 — the authoritative visual direction)
- **Earlier product brief:** [`brief-v3.md`](./brief-v3.md)

> **Design (Aug 2026):** the site was redesigned to the current brand — **terracotta**
> palette, **Plus Jakarta Sans**, the clipped **"t" logo mark**, full-width **colour zones**,
> and the tagline **"Architecture priced upfront."** Above the fold is radical restraint:
> logo + tagline + **Archie embedded live** (the conversation is the CTA). Below: a stats
> zone, an honest comparison table, banded pricing (Band B featured), and how-it-works.
> Deliberately **not** the earlier indigo SaaS look — Archie is a considered interface with a
> restrained "t" avatar, not a chatbot with a face.
- **WordPress theme:** [`dev/archlie/theme/archlie/`](../../dev/archlie/theme/archlie/) — a WP interpretation of this design (marketing site + the two-panel builder + project records), documented in [`wordpress-theme.md`](./wordpress-theme.md). Note brief §11 specs the production build as React; the theme is for a quick launch/review.

## What's in the folder

```
dev/archlie/
├── index.html              ← comparison shell (tabs: new vs original)
├── archlie/                ← the NEW Your Architect site (v3)
│   ├── index.html          ← marketing homepage
│   ├── start.html          ← two-panel AI onboarding (the headline feature)
│   └── assets/
│       ├── pricing.js      ← single source of truth for prices
│       ├── styles.css      ← Your Architect house style
│       ├── app.js          ← homepage (builds price table from pricing.js)
│       ├── onboarding.css  ← two-panel builder styles
│       └── onboarding.js   ← the scripted conversation + live package engine
└── reference/              ← frozen snapshot of the ORIGINAL Architects Direct site (v1)
```

## The comparison harness (what you asked for)

Open [`dev/archlie/index.html`](../../dev/archlie/index.html). A top bar has two tabs:

- **Your Architect — new · v3** (default) → the new site
- **Architects Direct — original · v1** → the frozen original, kept for reference

Each loads in an isolated iframe (no style bleed), your last choice is remembered, and
there's an **Open full screen** link. Both designs are live and fully clickable.

**Removing the old version once approved:** delete the `reference/` folder and the
`#tab-original` button in `index.html` — or, to promote Your Architect to the top level, move
the contents of `archlie/` up and drop the shell. Nothing else references the old design.

## What changed from v1 → v3

| | Architects Direct (v1) | Your Architect (v3) |
|---|---|---|
| **Name / domain** | Architects Direct | Your Architect (yourarchitect.uk) |
| **Legal** | Separate company (proposed) | Trading name of Tiam Architects Ltd |
| **Primary trust signal** | Fixed price | **ARB / RIBA registration** (vs unregistered CAD shops) |
| **Look** | Chunky, Screwfix-like, yellow/black | Calm, Resi/Arkiplan-like, indigo + green, soft cards |
| **Intake** | A form | **Two-panel AI conversation** with live package builder |
| **Services** | Planning, BC, PD, Tender | Planning, Building control, PD, **Listed building consent**, **Concept/3D add-on** |
| **Pricing** | Placeholder bands | Confirmed indicative v3 bands + **survey included** (banded, London rate) |
| **Extras** | — | 2 revisions included, 3–7 day delivery, 30-day quote validity |

Client-language note (brief §5): copy uses "building control drawings" (not "tender"),
which is the term homeowners actually search.

## The AI onboarding — what's real vs mocked

`start.html` is a faithful front-end of Brief v3 §6's two-panel interface: conversation
on the left, a **live package builder** on the right that adds/removes priced nodes and
updates the running total as you answer. In this static pass:

**Real / working:**
- The full 10-question scripted flow, one question at a time
- Live package panel: nodes are removable, total recomputes, **prices never appear in the chat** (only the panel), matching the brief
- Listed-building + London detection from the address (mock of the Historic England check — try `24 Roupell St, London SE1`)
- Survey costs (banded, London rate), concept add-on, consultant nodes ("appointed by you")
- **Tiam redirect** when over 150m² or fee > £3,500
- Delivery estimate, 2-revisions note, and a live **30-day quote-validity date**
- **Session persistence** to `localStorage` (mirrors the brief's cookie + Postgres record): reload and you're offered a resume
- **"Save your progress" bar** — after the first few questions a static prompt pins to the top of the conversation asking for an email so the client can come back later (early partial-lead capture, brief §4); it confirms, then tucks away, and is dismissible
- **Voice input** via the Web Speech API where the browser supports it
- **Photo upload** that returns an example vision design-prompt (mock of the Claude-vision step)

**Mocked (needs the real backend):**
- The conversation is scripted, not a live Claude call. In production this is a server-side
  Claude API call emitting the same add/remove/update package patches (§6 "Structured Output").
- No real database, Stripe payment gate, watermarked preview, or Stripe Connect payouts.

## Pricing (confirmed indicative — Brief v3 §5)

Held once in `archlie/assets/pricing.js` and read by both the homepage table and the
onboarding builder, so they can't drift.

| Service | Band A (≤50m²) | Band B (50–100m²) | Band C (100–150m²) |
|---|---|---|---|
| Planning application | £950 | £1,350 | £1,850 |
| Building control drawings | £850 | £1,200 | £1,650 |
| Permitted development | £750 | £950 | £1,250 |
| Listed building consent | £1,200 | £1,600 | £2,200 |
| Concept design (add-on) | £400 | £600 | £900 |

Survey added on top at banded rates (≈£295–£495; London rates where the address confirms
it). Final figures set by Tiam before launch.

## The real build (Brief v3 §11) — not this pass

Production Your Architect is a standalone **React app on Hetzner** (Node/PostgreSQL/Stripe/Clerk,
Claude API server-side, Historic England API, R2 file storage). This static site is the
**design + interaction reference** for that build and for the Tuesday review — it proves the
brand and the onboarding UX without standing up the backend. The scripted flow and the
`pricing.js` model map directly onto the React state machine and pricing engine.

## Placeholders to confirm

ARB registration number and company number appear as `[to confirm]` on the site and in the
footer legal line (Brief v3 §2 requires them shown prominently). Swap in real values before launch.

---
_Prepared by October Communications._
