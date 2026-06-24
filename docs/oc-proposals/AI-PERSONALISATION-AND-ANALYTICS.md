# October Proposals — AI personalisation, diagnostics & engagement analytics

Round-3 responses to Daniel's notes on the audit. These move three things into the core
product: **Claude-driven personalisation**, **live "current-state" diagnostics**, and
**deep engagement analytics with a Claude feedback loop**.

---

## 1. Accept / pay / book-a-call CTA  *(agreed)*

The proposal portal ends in one decision block with three actions:
- **Accept & e-sign** — records signature, flips proposal → accepted, CRM → *Closed Won*.
- **Set up payment to start** — **GoCardless** mandate (monthly) or **Stripe** (one-off
  deposit/project), chosen by the proposal's pricing shape.
- **Book a kickoff call** — calendar booking (the Hillcroft booking system already does
  date/time + confirmation; reuse it) for prospects who want to talk before signing.

These are not mutually exclusive — "book a call" is the low-commitment path that feeds your
"if they like the proposal, we hop on a call" flow.

## 2. Claude rewrites generic content per proposal  *(yes)*

Each boilerplate block (About, Capabilities, Services) is stored as a **canonical version**;
at proposal-build time Claude produces a **per-client re-angle** using the client context
(sector, situation, objectives). The *facts* stay fixed (guardrailed); only emphasis and
tone shift so it reads written-for-them, not templated. Always **editable**, with a one-click
"revert to canonical." This is what fixes the audit's "generic outweighs tailored" finding
without you rewriting boilerplate by hand.

## 3. ROI anchor  *(done)*

Implemented in the pricing mockup — a stats strip beside the price. Per proposal you pick
which proof stats to anchor with (ideally same-sector). See `mockups/pricing-table.html`.

## 4. Testimonials — keep company logos  *(clarified, important distinction)*

Reconciling with the "no client logos" rule: those are two different things.
- **Recipient's logo (the prospect):** never used — owners fixate on misuse. (Unchanged.)
- **Testimonial / selected-client logos (existing happy clients, with permission):**
  **valuable social proof — keep them.** Logo + quote + name where you have it. The logo
  carries the value you mentioned, so the Testimonials block stays logo-led.

So: prospect = name only (+ their website image); social proof = client logos. No conflict.

## 5. Case-study library — built by Claude from uploaded data  *(yes)*

A **Case Study library** (CPT/table) where each study has: title, **sector tag**, **service
tag(s)**, headline stats, body, optional Loom, live link.

- **File upload → Claude → draft study.** Drop in raw material (coverage report, results
  export, brief, PDFs, a results spreadsheet) and Claude drafts a structured case study in
  your voice, pulling out the stat highlights. You review/edit before it's saved.
- **Auto-filter per proposal:** the wizard suggests the 2–3 studies whose tags match the
  client's sector/service — so an architect sees architecture results, not all of them.

This is also where the audit's "filter to sector" + "more proof, less generic" land.

## 6. Reducing length & duplication  *(how)*

Concrete levers, mostly automatic once the content model is in place:
1. **Core + appendix split** — target a **10–12 page core** (cover, situation, proof,
   approach, investment, next step); push About/Capabilities/full client list/all services/
   awards into a **collapsible appendix** (web) / **optional back-matter** (PDF).
2. **Auto-select, don't dump** — include only the **2–3 tag-matched** case studies, not all
   (the SG/D PDF carried every study; Viewport even appeared **twice** — dedupe).
3. **Progressive disclosure on web** — long sections live behind "read more"/expanders, so
   the page feels short but the depth is there if wanted.
4. **Short vs full variant** — Claude can generate a **tight version** for warm prospects and
   a fuller one for formal RFPs, from the same source.
5. **PDF only renders selected sections** — unticked blocks don't print, so the PDF is as
   lean as the proposal needs to be.

## 7. Surface the risk reversal  *(agreed)*

The "you stay in control / no lock-in / 14-day pause" reassurance sits **next to the price
and the CTA** (see mockup), not buried in a pricing footnote. Ties to the pause feature.

## 8. Live "current-state" diagnostics — two tiers  *(grounded in OMI + DataForSEO)*

The audit's strongest personalisation idea (the `sg-d.com 4/100` SEO snapshot) becomes
**automated**, using infrastructure you already own:

- **Tier 1 — cold prospect (no access to their accounts):** pull **public** SEO metrics via
  the **DataForSEO** connector already referenced in OMI — domain rating, estimated organic
  traffic, keyword visibility, top competitors. Enter the prospect's domain → Claude writes a
  short "where you are now vs your competitors" snapshot. Works **before** they're a client,
  which is exactly when a proposal needs it.
- **Tier 2 — engaged/existing client (accounts connected):** call the **OMI platform API**
  (it already integrates GA4, Search Console, Google Ads, Meta, etc. per client) to pull
  richer current-state — real traffic, conversions, channel mix — for renewal/expansion
  proposals.

**Build dependency:** OMI needs a small **read API** (e.g. `GET /api/v1/clients/{id}/summary`)
the proposal plugin can call with a key. Flagged as a cross-app task in OMI's backlog. Tier 1
(DataForSEO) has no such dependency and can ship first.

## 9. Engagement analytics + Claude feedback loop  *(yes, in detail)*

Two layers:

- **Microsoft Clarity** embedded on proposal pages — free **heatmaps, scroll maps, session
  recordings, rage/dead-click detection**. Best-in-class for "what did they look at / click,"
  zero cost, privacy-friendly. Recommended over building this ourselves.
- **First-party event tracking** for the things Clarity can't label semantically, stored per
  proposal: section views, **time per section**, scroll depth, **Loom video plays / % watched**
  (via Loom's player events), CTA clicks, pricing-toggle interactions, appendix expands,
  accept/pay/book clicks, return visits. This is the data that tells you *which proposal
  argument is working*.
- **Claude feedback loop:** a **monthly + annual report**, written by Claude from the
  aggregated events across all proposals — e.g. "intro video watched on 80% of viewed
  proposals but only 30% finish it; pricing section is where 60% drop; won proposals spend 2×
  longer on case studies." With **concrete suggestions to improve the template** (shorten the
  intro video, move proof above pricing, etc.). The proposal system effectively **A/B-learns
  on itself** and tells you how to sell better.

---

## Knock-on scope additions

- **Kickoff booking** step in the portal (reuse Hillcroft booking).
- **Claude services:** per-proposal content re-angle (#2), case-study drafting from uploads
  (#5), diagnostics summary (#8), engagement reports (#9) — all behind one `OCP_Claude` class
  with guardrails, mirroring `HGD_Claude`.
- **Integrations:** DataForSEO (Tier-1 diagnostics, now), OMI read-API (Tier-2, pending OMI),
  Microsoft Clarity (analytics), Loom player events.
- **Phasing:** #1/#3/#4/#6/#7 are P1 (content model + CTA). #2/#5 land with the Claude layer
  (P2). #8 Tier-1 + #9 Clarity are P2; #8 Tier-2 (OMI API) + Claude reporting are P3.
