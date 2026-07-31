# Archlie — Project Brief, Version 3

> **Since this brief:** the product has been renamed **Your Architect** (domain
> **yourarchitect.uk**), and the AI onboarding assistant is named **Archie**. This
> document is kept as the original transcription; references to "Archlie" below are the
> working name at the time of writing.

*Prepared by October Communications | July 2026. Transcribed from
`Archlie_Brief_v3.docx`. Working document — pricing figures are indicative and must be
confirmed by Tiam before launch. The "Site Up" platform concept is noted but out of scope.*

## 1. Background

Tiam Architects operates at the premium end of London's residential market (complex
conservation, heritage and high-spec projects), generating leads via paid social and press
at ~£166 per lead. A distinct market exists below that: homeowners needing straightforward
drawings for planning, building control, permitted development or tender packages —
price-sensitive, process-driven and numerous. Tiam is not set up to serve them and does not
want to under the Tiam brand. **Archlie** is the solution: a separate, self-service
architectural drawing platform operating as a **trading name under Tiam Architects Ltd**,
capturing high-volume, lower-complexity work without compromising the core practice.

## 2. Legal and Business Structure

Archlie is a **trading name of Tiam Architects Ltd — not a separate legal entity**. This
avoids duplicating accountancy, RIBA membership and PI insurance. All Archlie work is
covered by Tiam's existing PI policy. Invoices show "Tiam Architects Ltd trading as
Archlie." The website carries a clear statement confirming **ARB and RIBA registration with
the registered company number**, giving clients a formal route for queries/complaints. Tiam
to confirm with the PI broker that trading-name work is explicitly covered.

## 3. Brand Name

Working name **Archlie**; domain **archlie.com** available. Short, easy to spell/say, no
price signal, no existing associations. Doesn't contain "architect" — neither does Resi.
Visual identity communicates **transparency and professionalism without premium
positioning**. Reference: Arkiplan, Resi. Clean sans-serif, clear pricing hierarchy, no
portfolio imagery, **ARB/RIBA registration shown prominently as the primary trust signal**.
No Tiam branding, photography or named personnel in any Archlie material.

## 4. Objectives

- Generate revenue from a segment Tiam can't serve at its fee level.
- Low overhead: minimal client contact, standardised output, automated where possible.
- Lead feeder: projects over a size/complexity threshold redirect to Tiam as full commissions.
- Establish **ARB/RIBA registration as a differentiator** vs unregistered CAD operators.
- Capture partial leads: even non-completions generate pipeline data and automated follow-up.

## 5. Service Model

Fixed-price packages for standard residential works, **RIBA stages 0–4**. Stage 5
(construction) by arrangement only, not priced upfront. Clients build their package through
a **conversational AI interface** and receive an instant fixed price. No initial call.

**Package types:** Planning application · Building control / building regulations ·
Permitted development · Listed building consent · Concept design & 3D visualisations
(add-on) · Project coordination / site attendance / consultant liaison (by arrangement).

*Terminology:* "construction drawings" and "building control drawings" are the terms
clients use in search and on Bark. "Tender" is not widely understood by homeowners — all
copy uses client language.

**Pricing** (fixed, shown before any personal details; survey included using panel-surveyor
banded rates; confirmed indicative, Tiam to adjust for time-cost before launch):

| Service | Band A (≤50m²) | Band B (50–100m²) | Band C (100–150m²) |
|---|---|---|---|
| Planning application | £950 | £1,350 | £1,850 |
| Building control drawings | £850 | £1,200 | £1,650 |
| Permitted development | £750 | £950 | £1,250 |
| Listed building consent | £1,200 | £1,600 | £2,200 |
| Concept design (add-on) | £400 | £600 | £900 |

Survey costs on top at banded rates: ≈£295–£350 (A), £350–£420 (B), £420–£495 (C), subject
to surveyor agreement. London pricing applies where the Historic England API confirms the address.

**Revisions:** two included per package; from the third onward the client pays via the
portal before processing; further revisions time-charged.
**Delivery:** realistic **3–7 working days** shown at quote. No 48-hour promises — quality
is the differentiator.
**Quote validity:** 30 days, expiry shown at quote generation (applies to Archlie and,
going forward, all Tiam fee proposals).

**Tiam redirect threshold** — redirect to Tiam for a full commission when: floor area
> 150m²; listed building requiring more than a standard consent; estimated fee > £3,500;
client selects ongoing project management or construction-stage; or complexity scoring flags
it as outside standard scope.

## 6. AI Onboarding — Full Specification

Replaces both intake form and initial call. **Two-panel layout:** conversation on the left,
a **live package builder** on the right. As the user answers, Claude extracts structured
data and emits events updating the package panel in real time — the user never fills a form.

- **Two-panel interface:** each confirmed piece of info adds/removes/updates a node with a
  running total. Nodes are removable/editable ("actually it's not listed" → node removed,
  total updates). **Claude never states a price in conversation — the panel does.**
- **Voice input:** Web Speech API, client-side, no cost; hold-to-record on mobile; transcript
  becomes plain text. Primary input on mobile.
- **Session persistence:** a project record is created in PostgreSQL tied to a browser cookie
  the moment the conversation starts — before any personal details. Stores UUID, full history,
  package state (JSON), status (draft/submitted/in_progress/complete), timestamps, and
  `anonymous: true` until an email is provided. Returning via cookie resumes the conversation
  with a context summary. **Pricing is never conditional on contact details.**
- **Backend pipeline visibility:** admin dashboard shows every record incl. anonymous ones —
  package so far, last question, dropout point, time in session — so Tiam can see which
  question caused drop-off.
- **The 10 questions** (one at a time, natural language): (1) property address → triggers
  Historic England listed check + London pricing; (2) what you're looking to do → maps to
  service; (3) planning permission status → planning vs building control; (4) size → m² band;
  (5) existing survey/drawings → adds/removes survey node; (6) structural changes → engineer
  flag; (7) shared wall → party wall surveyor; (8) concept/3D → upsell add-on; (9) timeframe
  → pipeline only; (10) name/email → optional, framed for the user, quote already visible.
- **Structured output:** each response = conversational message + a JSON patch
  (`{add, remove, update, total}`) applied to the panel.
- **Photo upload:** vision-capable Claude call generates a one-paragraph design prompt stored
  in the record; camera capture on mobile. Phase 2 adds AI visualisation of proposed works.
- **System-prompt constraints:** role = project assistant; do not discuss fees in
  conversation, no planning/design advice, stay in scope; fallback offers a call booking;
  every response includes message + JSON patch.
- **Token cost:** ~500 tokens per 10-turn conversation; well under £0.01 per session.

## 7. Survey Partner

Survey costs bundled into the quote at banded rates agreed with a preferred surveyor
committing to a one-week turnaround in exchange for volume. Target rates: £295–£350 (A),
£350–£420 (B), £420–£495 (C). Survey Pro reference: £350 outside London, £495+VAT London. A
disclaimer notes pricing relies on accurate submitted information; omitted material details
(listed status, party wall) may revise pricing.

## 8. Consultant Structure and Liability

Archlie does not employ or appoint structural engineers, surveyors or party wall advisors.
Where needed, consultants are **appointed directly by the client** under embedded platform
terms. Panel consultants: responsible for their own scope/liability; paid automatically via
**Stripe Connect** on completion; opt-in per project.

## 9. Revenue Model

Collected upfront on drawing delivery (watermarked-preview model). Automatic distribution
per completed project: **Tiam 60%**, structural engineer (where appointed) 20%, surveyor /
party wall 20%, **October Communications 15% of Tiam's 60% (9% of total)** — deducted
automatically, no upfront fees. Consultant splits only where that consultant's node is in
the confirmed package. All payouts via Stripe Connect. *Example: a £1,350 planning-only job
returns £735 to Tiam and £121.50 to October.*

## 10. Workflow Scenarios

- **A — Client has existing survey drawings:** no survey node; client uploads at submission;
  Tiam reviews adequacy; if inadequate, offers a surveyor referral at banded rate.
- **B — Client needs a survey arranged:** survey node added; platform refers to panel
  surveyor (one-week return); drawings passed to Tiam.
- **C — Client has planning permission, wants drawings to build:** routes to building control
  drawings marked "building control only — not issued for construction"; a request for
  construction-issued drawings triggers the Tiam redirect (Archlie does not issue for
  construction on third-party designs).

## 11. Technical Build

Standalone **React app on Hetzner** (not WordPress). Stack: React + Astryx design system;
Node.js on a Hetzner VPS (REST API); **PostgreSQL**; **Stripe** (payment gate + revision
charges) and **Stripe Connect** (consultant payouts); **Clerk/Auth.js** (accounts +
cookie session persistence); **Claude API** server-side with streaming, tightly scoped
system prompt; **Historic England Listed Buildings API** (free) on address entry; Hetzner
Object Storage / Cloudflare R2 for files (watermarked preview → full file on payment);
**Web Speech API** for voice; **Resend/Postmark** for email.

**Phase 1 (core):** two-panel AI onboarding + live builder + voice · cookie anonymous
persistence from first message · photo upload with vision design prompt · Historic England
listed detection · pricing engine · client portal with upload + watermarked preview ·
approve/comment/reject sign-off with card gate on 3rd+ revision · payment gate before
release · partial-submission follow-up email · admin dashboard with full pipeline visibility.

**Phase 2:** Stripe Connect consultant payouts · complexity scoring auto-routing · live
construction-cost data (RICS TBC) · AI property visualisation from photo · mobile app with
camera capture as primary entry point.

## 12. Immediate Next Steps

- **Tiam:** confirm PI broker is comfortable with trading-name work; finalise pricing bands;
  confirm structural/surveyor panel participation; negotiate fixed banded survey rates with
  one-week turnaround; share current platform credentials.
- **Daniel:** register archlie.com (+ archlie.co.uk backup); build Archlie v1 on Astryx and
  share for review ahead of the Tuesday meeting; research RICS / construction-cost APIs for
  Phase 2; send Tuesday 6:30–7:00pm invite; send Weaver / Vetted Contractors link re the Site
  Up concept.
- **Both:** document any additional workflow scenarios beyond Section 10 before the call.
