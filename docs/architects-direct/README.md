# Architects Direct — website

Public-facing marketing site and self-service front end for **Architects Direct**,
the fixed-price architectural drawing service that operates as a sister company to
Tiam Architects.

Code lives in [`dev/architects-direct/`](../../dev/architects-direct/); this folder
holds the brief and docs.

## What this is

A self-contained static website (no build step, no dependencies) that delivers the
**public + intake** side of Phase 1 from the brief:

- Clear, price-forward marketing pages (hero, how-it-works, services, FAQ).
- An **instant pricing calculator** — service type × floor-area band → fixed price.
- The **Tiam redirect logic** from Section 8 of the brief, built in.
- A short **self-service intake form** with validation and a friendly confirmation.

It is deliberately **not premium**: chunky grotesque headings, thick black borders,
one signal-yellow accent, no architectural portfolio imagery and no Tiam branding —
in line with Section 6 (Resi/Screwfix functional positioning).

## Files

| File | Purpose |
|------|---------|
| `dev/architects-direct/index.html` | The whole page (all sections). |
| `dev/architects-direct/assets/styles.css` | House style / design tokens. |
| `dev/architects-direct/assets/app.js` | Pricing calculator, redirect logic, intake form. |

Open `index.html` in a browser — nothing to install. Fonts (Archivo + Inter) load
from Google Fonts and fall back to system sans if offline.

## Pricing model

Prices are held in **one table** at the top of `app.js` (`PRICES`) so Tiam can set
the real figures in one place before launch:

| Service | Band A (≤50m²) | Band B (50–100m²) | Band C (100–150m²) |
|---------|---------------|-------------------|--------------------|
| Planning application | £1,200 | £1,800 | £2,400 |
| Building control / regs | £900 | £1,400 | £1,900 |
| Permitted development | £750 | £1,100 | £1,500 |
| Tender drawings | £1,400 | £2,000 | £2,800 |

> ⚠️ **These are indicative placeholders for demonstration only.** Section 3 of the
> brief states exact pricing is set by Tiam before launch, accounting for consultant
> revenue share. The figures are labelled as indicative everywhere they appear on the
> site.

## Redirect logic (Section 8)

The calculator routes a project to Tiam Architects (instead of showing a fixed price)
when **any** of these are true — matching the brief:

- Floor area **over 150m²**.
- **Listed building**.
- Client selects **"I need ongoing project management."**

The redirect panel names the specific reason(s) and swaps the CTA to
"Request a consultation."

Fee-threshold redirect (Section 8, bullet 3) is intentionally left for Tiam to define,
since the fee bands themselves are still TBC.

## What is NOT in this build (needs a backend)

This is the static front end. The following Phase 1 items require server-side work and
are **stubbed** here — the intake form confirms success client-side but does not yet
persist:

- Project **account creation** on submission.
- **Partial-submission follow-up** email automation.
- Drawing **upload** + **watermarked preview** delivery.
- **Payment gate** before full drawing release.

The brief specifies a WordPress build on existing infrastructure. The natural next step
is to port this markup/style into a WordPress theme/template and wire the intake form to
account creation, then layer payments (e.g. WooCommerce/Stripe) and the project portal.
The `PRICES` table and form field names are structured to make that wiring
straightforward.

## Phase 2 (future)

Per the brief: AI-assisted intake, automatic consultant revenue distribution, and
complexity scoring that auto-routes oversized/listed projects. The redirect rules here
are the seed of that scoring logic.

---
_Prepared by October Communications._
