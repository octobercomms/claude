# October Proposals — Plugin Scope

**App name:** October Proposals
**Slug:** `oc-proposals` · **PHP prefix:** `OCP_` / `ocp_` · **Code:** `dev/oc-proposals/` ·
**Docs:** `docs/oc-proposals/`
**Runs on:** octobercomms.com (your own site — this is October's in-house proposal tool, not
a client deliverable)
**Status:** Scope for review — no code written yet.

> **One line:** A wizard-driven WordPress plugin that builds an October proposal from a
> reusable block library + a pricing page, then publishes it as **both** an on-brand web
> page (with video + animated process + accept/e-sign/pay) **and** a downloadable PDF — from
> a single source.

---

## 1. Why a new plugin (and not extend Hillcroft)

The Hillcroft Garden Designer plugin already contains, in production, ~80% of the machinery
this needs. We **harvest its proven patterns** into a clean standalone plugin rather than
bolt onto a client-specific product:

| Need here | Already exists in Hillcroft (to lift & generalise) |
|-----------|----------------------------------------------------|
| Wizard admin (step-by-step build) | project editor `?step=` pattern (`class-hgd-admin.php`) |
| Proposal model (token, statuses, accept, sign, expiry) | `HGD_Proposal` + `hgd_proposals` table |
| Standalone on-brand web page (not themed) | `HGD_Proposal_Portal` (renders own full HTML, token-gated) |
| Print-ready PDF page (`@page` CSS, "Save as PDF") | `HGD_Documents` (keepsake/book) |
| Stripe deposit/milestone payments | `HGD_Stripe` + booking webhook |
| Settings / pricing input page | `HGD_Settings` + admin settings view |
| GitHub-Action release + self-update | `HGD_Updater` (tag → zip → in-plugin update) |
| AI drafting assist (optional) | `HGD_Claude` |

Reasons to keep it separate: Hillcroft is a single-client product with garden-specific
models (plants, renders, measure); this runs on **your** site for **all** your prospects;
and a clean break avoids coupling your sales tooling to a client codebase. We reuse the
*code patterns*, not the plugin.

---

## 2. Core concept — blocks + types, one source, two outputs

**The content model (from the audit):** a proposal = a little per-client writing on top of a
reusable library, rendered once to web **and** PDF.

```
Reusable library (write once, reuse everywhere)
  ├─ Company boilerplate: About, Capabilities, Services, Awards, contact/legal footer
  ├─ Selected Clients (the full list)
  ├─ Testimonials (name, role, quote, photo, link)
  └─ Case Studies (title, sector tag, service tag, stats, body, video, live link)

Proposal "types" (presets = which blocks + what order + default pricing shape)
  ├─ Full Marketing/PR Retainer   (→ SG/D)
  ├─ Website Rebuild               (→ Seilern)
  ├─ Event PR                      (→ IndieWalls)
  └─ (extensible: add your own)

Per-proposal (the wizard collects only what's unique)
  ├─ Client: name, contacts, logo, sector, currency, VAT flag
  ├─ Tailored writing: Situation, Objectives, Strategy, Tactics, Plan-of-Work notes
  ├─ Auto-selected proof: case studies filtered by the client's sector/service tags
  ├─ Pricing: line items (one-off / monthly / project), deposit, milestones
  └─ Media: intro video, process video, per-case-study video

        ↓ single render
  ┌─────────────────────┬─────────────────────┐
  │  WEB PAGE            │  PDF                │
  │  on-brand, token URL │  print-optimised    │
  │  video + animation   │  same content       │
  │  accept · e-sign · pay│  "what happens next"│
  │  view tracking       │  download button     │
  └─────────────────────┴─────────────────────┘
```

Choosing a **type** pre-loads the wizard with the right blocks in the audit's recommended
order (proof before price), so a new proposal starts 80% done.

---

## 3. Admin wizard (mirrors the Hillcroft step pattern)

`Proposals → Add New` opens a stepped editor (`?step=`). Every AI/auto output is editable —
the proposal always reads as yours.

1. **Client & type** — pick proposal type; enter client name, contacts, logo, sector,
   currency (GBP/USD/EUR), VAT on/off. Type sets the default block set + order.
2. **Situation & objectives** — the tailored SOST writing. Optional "draft with Claude" from
   a few bullet inputs (you edit the result).
3. **Proof** — case studies auto-suggested by sector/service tag; tick to include/reorder.
   Pull testimonials the same way.
4. **How we work** — choose Plan-of-Work stages/tactics to show; attach the process video.
5. **Pricing** — the pricing page (see §4).
6. **Media & extras** — intro video, process video, FAQ, risk-reversal line, expiry date.
7. **Review & publish** — live preview of web + PDF; set status; copy the private link; send.

A **status lifecycle** runs alongside: `draft → sent → viewed → accepted → won / lost`
(viewed/accepted driven by the web page; reminders via the follow-up pattern).

---

## 4. Pricing page (the "input pricing on a page" requirement)

A dedicated builder, per proposal:

- **Line items**, each tagged **one-off**, **monthly**, or **project/milestone**, with
  qty/rate or fixed amount, and an optional "approx hours" note.
- **Auto totals** per bucket (one-off total, monthly total, project total) — no manual maths,
  so the SG/D-style confusion can't happen.
- **Currency** + **VAT** from the client settings, applied and labelled correctly everywhere.
- **Deposit / milestone schedule** for project work (e.g. 40% to start, 40% on draft, 20% on
  delivery) — feeds the Stripe payment step.
- **Optional ROI anchor + risk-reversal** fields rendered beside the total (audit §3.5/§3.9).
- Optionally save a **price book** of reusable line items (your standard rates) to pick from.

Output is the clean "Investment" section the audit recommends, identical on web and PDF.

---

## 5. The web page (custom page with video + process)

A standalone, on-brand page (reusing the `HGD_Proposal_Portal` approach — renders its own
full HTML, not the theme) reached by an unguessable token URL, e.g.
`octobercomms.com/proposal/<token>`:

- **Personalised hero** — client name + logo, job type, date.
- **Embedded video** — Daniel's intro, the **process walkthrough**, and per-case-study video.
- **Animated process** — the 5-stage Plan of Work as a scrolling/animated timeline (the
  brief's "process on that page").
- **Filtered proof** with live coverage links and ROI stats.
- **Interactive pricing** — toggle monthly/annual, optional add-ons recompute the total.
- **One CTA** — Accept & e-sign, and (where relevant) pay the deposit via Stripe inline.
- **Mobile-first**, `noindex`, **view tracking** → notify you on first open + on accept.
- **Design tokens** — fonts + brand colours from Settings (the only design change you want),
  applied via CSS variables so it always matches the live site.

## 6. The PDF (downloadable version)

Same content, print-optimised. Two viable routes — **decision needed** (see §9):

- **A. Browser print-to-PDF** (Hillcroft's current approach): an `@page`/A4 CSS layout with a
  "Download PDF" button that uses the browser's print engine. Zero server dependencies,
  pixel-matches the web CSS, free. Slightly less control over headers/footers/page breaks.
- **B. Server-side render** (e.g. Dompdf/mPDF bundled, or a headless-Chrome/API service):
  true one-click attachable PDF, full control of pagination. More moving parts; headless
  Chrome isn't available on all hosts.

**Recommendation: ship A in v1** (proven, matches Hillcroft, no infra), add B later only if
you need auto-attached PDFs in emails.

---

## 7. Settings

- **Brand/design tokens:** font families + brand/accent colours (matches site — your only
  design change).
- **Company details:** legal footer, VAT no., registered address, logo, default currency.
- **Stripe keys**, **Claude key** (optional, for draft-assist), e-sign settings.
- **Block library management:** Case Studies, Testimonials, Clients, Services, Awards (CPTs or
  custom tables with tags).
- **Proposal types:** edit the preset block-sets/order; add new types.

---

## 8. Build phases

**Phase 1 — MVP (the core ask):** wizard (steps 1–7), block library, the three proposal
types, pricing builder, web page with **video + animated process**, browser **PDF download**,
design tokens, status lifecycle, view tracking, updater. *No payments/e-sign yet — CTA is
"accept" + notify.*

**Phase 2 — Close the loop:** Stripe deposit/milestone payments, e-signature, automated
follow-up reminders, engagement analytics dashboard.

**Phase 3 — Polish:** Claude draft-assist for SOST sections, server-side PDF (route B) if
needed, A/B different intros, reusable price book, per-type template editor in the UI.

---

## 9. Decisions — RESOLVED

These are now answered in **[DECISIONS.md](DECISIONS.md)**. Summary:

1. **PDF** — server-side **mPDF** (Architourian approach), **landscape A4 / US Letter**.
2. **Payments** — **GoCardless** Direct Debit (recurring) + **Stripe** (one-off), invoice on
   request, behind one abstraction. E-sign + pause in Phase 2.
3. **AI** — a grounded **Claude pricing agent** (Phase 3) + public proposal builder.
4. **Video** — **Loom** embeds.
5. **URL** — `octobercomms.com/proposal/<token>` confirmed.
6. **Currency/VAT** — per-proposal; US ⇒ USD + Letter + no VAT; else GBP/chosen + VAT.

Also locked: **no client logos** (name + October logo + a client-website image); **native
CRM** from the Sales Leads Tracker; **client-controlled pause** with the 14-day notice rule.

---

## 10. Out of scope (v1)

- CRM / pipeline management (status lifecycle only; not a full CRM).
- Multi-user roles/permissions beyond standard WP caps.
- Client-side proposal editing/collaboration.
- Anything garden/Hillcroft-specific.
