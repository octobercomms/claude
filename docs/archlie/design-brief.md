# Your Architect — Brand & Website Design Brief (Aug 2026)

*Prepared by October Communications. Transcribed from `Your_Architect_Design_Brief.docx`.
This is the current, authoritative design direction for Your Architect and supersedes the
visual direction in the earlier v3 brief. Settled: the tagline (**Architecture priced
upfront**), the name (**Your Architect / Archie**), the typeface (**Plus Jakarta Sans**),
and the **terracotta** palette. Layout execution is the designer's, within the constraints.*

## 1. What we're building
A self-service architectural drawing platform for UK homeowners — fixed-price planning,
building control, permitted development and listed building drawings for standard
residential projects. A trading name of **Tiam Architects Ltd** (ARB-registered, RIBA
chartered). The core mechanic: a homeowner talks to an AI assistant, **Archie**, who builds
their package through a short conversation; a fixed price assembles in real time. Domain:
**yourarchitect.uk**.

## 2. Positioning
The pain is not "architecture is too expensive" — it's "I don't know what it costs and I'm
afraid to find out." The absence of pricing reads as "not for you." Your Architect removes
that barrier by showing the price upfront (the Warby Parker / Wise playbook). The villain is
how architecture is usually priced and sold — the opacity, the "contact us for a quote."
**What clients pay for, in priority:** certainty of process · planning approval rate (feature
90%+) · speed to start · fixed price · ARB/RIBA registration (hygiene, not hero — *show it,
don't lead with it*).

## 3. Tone of voice
Audience 35+, capable, considered. Plain English (say "construction drawings" not "tender";
"shared wall with a neighbour" not "party wall"). Direct, economical, British English.
Reassuring without being soft. Confident, not clever.
**Tagline: "Architecture priced upfront."** — sits under the logo, stands alone, no comma,
no subline.

## 4. Naming
Brand: **Your Architect**. Assistant: **Archie** (the face/personality). Legal: Tiam
Architects Ltd trading as Your Architect (invoices + footer).

## 5. Visual direction
**Do NOT produce a generic SaaS site:** no shadowed card on white, no hero-left/panel-right
marketing split, no indigo/purple, no pill badges, no lifestyle/stock photography, no gradient
meshes. Considered and intentional (references: Canevas, YOWIE, IKEA's disciplined colour).
No portfolio photography exists — the language works through **type, colour, layout and
structure**. Full-width **colour zones**: the page reads as bands of colour before words,
executed with craft (not stiff flat blocks).

- **Type:** Plus Jakarta Sans. ExtraBold/Bold display, Medium UI, Regular body. The clipped
  lowercase **"t"** cropped tight is the logo mark / favicon / app icon.
- **Colour (terracotta — brick, warm, unused by competitors):** primary `#C4603A`, hover
  `#A84D2F`, alert `#E05A30`, pale wash `#FAF0EB`, **sage `#4A7C6F` for confirmation only**,
  off-white bg `#FAFAF8`, text `#1C1C1A`, hairlines `#E8E5E0`.

## 6. Homepage
**Above the fold — radical restraint, only three things:** the logo; the tagline; and
**Archie's conversation, already running, embedded in the page** (not behind a button, not
on a separate page). The conversation is the CTA. No badges, bullets, sub-headline or hero
image above the fold.
**The Archie interface:** two-panel — conversation + a live package builder; confirmed items
appear as line items with prices and a running total assembles live; the **total is the
visual hero of the panel — large, terracotta**; Archie never states a price in conversation
(the panel does); voice input on every message; a project record from the first message
(cookie-based) so a returning user resumes; **pricing is never gated behind contact details**.
Not a gimmicky-chatbot aesthetic — a considered interface.
**Below the fold (designer's discretion):** stats zone (approval rate 90%+, £0 hidden fees,
average turnaround) · honest comparison (Your Architect vs traditional practice vs
unregistered CAD) · pricing (three bands A/B/C, Band B featured "most common") · how it works
(four steps) · footer (logo, tagline, legal, ARB/RIBA).

## 7. Indicative pricing
Sit just below comparable published rates. Survey added at banded rates (≈£295–£495). All
prices include two revisions. Confirmed by Tiam before launch.

| Service | Band A | Band B | Band C |
|---|---|---|---|
| Planning application | £950 | £1,350 | £1,850 |
| Building control drawings | £850 | £1,200 | £1,650 |
| Permitted development | £750 | £950 | £1,250 |
| Listed building consent | £1,200 | £1,600 | £2,200 |
| Concept design (add-on) | £400 | £600 | £900 |

## 8. Technical notes
Standalone **React app on Hetzner** (not WordPress). Archie via **Claude API, server-side,
streaming**, system prompt scoped to package-building. Voice: Web Speech API. Payments:
Stripe + Stripe Connect. Listed detection: Historic England API on address entry. DB:
PostgreSQL (records, history, package state, anonymous session persistence). No
localStorage/sessionStorage in the artifacts context — use React state / server-side.

## 9. Explicit do-nots
No generic SaaS layout · no indigo/purple/startup-blue · no lifestyle/stock photography ·
no gimmicky-chatbot chat-bubble aesthetic · no "contact us for a quote" · no industry jargon ·
no clutter above the fold · no Tiam branding, photography or named personnel.
