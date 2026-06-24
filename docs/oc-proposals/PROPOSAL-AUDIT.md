# October Proposal — Audit & Improvement Plan

**Subject:** The October Communications proposal template, as sent to SG/D Architecture
(July 2025), Studio Seilern (June 2026) and IndieWalls (April 2026).
**Purpose:** Establish what's working, what's costing you deals, and the target shape the
new plugin should generate. This audit *defines the content model* the plugin in
`PLUGIN-SCOPE.md` is built to produce.

---

## 1. What the three proposals actually are

All three are the **same master template** re-skinned per client and per job type:

| Proposal | Job type | Pricing shape | Pages |
|----------|----------|---------------|-------|
| SG/D Architecture | Full marketing/PR retainer | £750 one-off + £1,000/mo | 25 |
| Studio Seilern | Website rebuild | Single project fee + retained extras | 21 |
| IndieWalls | Event PR (15-yr milestone) | Single project fee, split across engagement | 19 |

Shared spine (in current order):

> Cover → Introduction letter → About → Selected Clients → Testimonials → Capabilities →
> Approach (SOST: Situation · Objectives · Strategy · Tactics) → Plan of Work (5 stages) →
> **Pricing** → Services (PR, Social, Content, SEO, PPC, CRO) → Case Studies → Awards → Contact

The template is genuinely good — the SOST framework, the 5-stage Plan of Work, and the
case-study results (454% ROI, £186k gross profit, +109% organic traffic) are strong,
credible assets. The problems below are about **sequencing, focus, and format**, not
substance.

---

## 2. The headline problem: proof and price are in the wrong order

The single biggest conversion issue is **order of information**:

- The price (p11) lands **before** the most persuasive proof — the case studies with hard
  ROI numbers don't appear until **pp18–23**, *after* the reader has already seen the cost.
- Between price and proof sit 6 pages of generic service descriptions (PR, Social, SEO,
  PPC, CRO). A reader weighing "is this worth £1,000/mo?" hits the number, then has to wade
  through boilerplate before reaching the evidence that justifies it.
- By the time the strongest argument (454% ROI) appears, the decision is psychologically
  already made.

**Fix — reorder around the buyer's actual questions:**

1. *Is this for me?* → personalised cover + intro
2. *Do they understand my situation?* → SOST **Situation** (this is already tailored and
   specific — lead with it)
3. *Can they actually deliver?* → **Case studies, filtered to the client's sector** (for an
   architect, the residential-architecture SEO results; not all of them)
4. *What exactly will they do?* → Objectives · Strategy · Tactics · Plan of Work
5. *What does it cost?* → Pricing, now framed against the ROI just demonstrated
6. *What happens next?* → a single, explicit CTA (accept / book a call / pay deposit)
7. *Reference material* → Capabilities, Services, full client list, awards → **appendix**

Proof before price. Tailored before generic. One clear next step at the end.

---

## 3. Prioritised findings

### High impact

1. **No explicit next step / CTA.** All three end on a passive Contact page. There is no
   "here's how to say yes." Every proposal should end with one unambiguous action. The web
   version makes this a button (Accept & e-sign / Pay deposit / Book kickoff); the PDF
   should still state it in words.

2. **Pricing page is hard to parse.** SG/D p11 mixes a per-stage table ($250/$250/$0/$250,
   sub-total $750) with a "$1,000 monthly" retainer and "$1,000 approx 10 hours" — three
   different numbers that take effort to reconcile. Restructure as a clean **Investment**
   section: one-off onboarding (what it buys), then monthly (what's included each month),
   with an optional annual/prepay option, and an explicit "what's not included." Show the
   recurring number *with* its deliverables beside it, not in a grid.

3. **Currency / VAT inconsistency.** SG/D is priced in **USD** (Bay Area client) but every
   page footer carries **GB VAT registration** and a £-based company. State the currency
   once, clearly, and say whether VAT applies to this client. The plugin should make
   currency + VAT a per-proposal setting so this never has to be hand-managed.

4. **Generic content outweighs tailored content.** About, Capabilities, the six Services
   pages and Awards are **identical across all three proposals**. The tailored, persuasive
   material (Situation, Objectives, Strategy, Tactics, the SEO domain-rating snapshot,
   pricing) is the minority and is sandwiched in the middle. Move boilerplate to an
   appendix; foreground what's specific to this client.

5. **Anchor the price to the client's own ROI.** You have the numbers — 454% ROI, 359% ROI,
   £186k profit from £41k spend. Put a one-line ROI framing *next to* the price ("clients on
   comparable programmes have seen 350–450% ROI") so the cost reads as an investment with a
   track record, not an expense.

### Medium impact

6. **Testimonials lack faces and attribution.** They're quoted by company only. Add a
   person's name + role, ideally a headshot, and link to the live coverage/result. Named,
   human testimonials convert far better than anonymous company quotes.

7. **Filter case studies to the reader's sector.** SG/D got all case studies; a residential
   architect mostly needs the residential-architecture results. The plugin should let you
   tag case studies (sector / service) and auto-select the relevant ones per proposal.

8. **Length and duplication.** 25 pages is long for a solo-practice prospect. The Viewport
   case study appears **twice** (pp19–20). A tighter core (≈10–12 pages) with everything
   else in an appendix respects the reader's time.

9. **Surface the risk reversal.** "Cancel up to 14 days before the next payment" is buried
   in a pricing footnote. For a monthly retainer this is a genuine objection-killer — make
   it a visible reassurance near the CTA ("no lock-in — pause or cancel any month").

10. **More "current state" diagnostics like the SEO snapshot.** SG/D p15 shows
    sg-d.com 4/100 vs competitors — concrete, personalised, and it implicitly sells the
    service. More of this kind of client-specific data (traffic, rankings, coverage gaps)
    raises perceived insight and justifies the fee.

### Format / channel

11. **PDF-only is a missed opportunity.** A static PDF can't carry video, isn't great on
    mobile (where many proposals are first opened), and gives you **zero visibility** into
    whether it was opened. The brief's core ask — a **web page with video + process** plus a
    **downloadable PDF** — directly fixes all three. (See the plugin scope.)

12. **No engagement tracking.** You currently can't tell if a proposal was viewed, when, or
    how far the reader got. The web version gives open/view notifications and lets you time
    your follow-up.

---

## 4. Target proposal shape (what the plugin generates)

The improved proposal — delivered as **both** an on-brand web page and a matching PDF:

| # | Section | Web extras | Tailored? |
|---|---------|-----------|-----------|
| 1 | **Cover** — client name + logo, job type, date | personalised hero | ✦ per client |
| 2 | **Introduction** — short personal letter from Daniel | 30–60s intro video | ✦ |
| 3 | **Your situation** (SOST Situation) | — | ✦ |
| 4 | **Proof** — 2–3 case studies filtered to sector, with ROI stats | case-study video, live links | ◑ auto-selected |
| 5 | **Objectives & Strategy** | — | ✦ |
| 6 | **How we work** — Plan of Work / Tactics | **process walkthrough video**, animated 5-stage timeline | ◑ |
| 7 | **Investment** — clean pricing, currency/VAT correct, ROI anchor, risk reversal | interactive (toggle monthly/annual, optional add-ons) | ✦ |
| 8 | **Next step** — single CTA: accept & e-sign / pay deposit / book kickoff | button + Stripe + e-sign | ✦ |
| 9 | **Appendix** — About, Capabilities, full client list, all services, awards, testimonials | collapsible | ✗ boilerplate |

✦ = written per client · ◑ = assembled from a library, auto-filtered · ✗ = static boilerplate

This is the content model `PLUGIN-SCOPE.md` is designed to produce: a small amount of
per-client writing on top of a reusable library of blocks, rendered once to two formats.

---

## 5. Design note

Per your brief, the visual design only needs **fonts and colours** changed to match the
current octobercomms.com site — layout/structure stays. In the plugin this becomes a few
**CSS design tokens** (font families, brand colours, accent) set once in Settings and
applied to both the web page and the PDF, so the look always matches the live site and you
can re-skin in seconds. No per-proposal design work.
