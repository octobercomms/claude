# October Proposals — Decisions & Answers (round 2)

Captures the decisions Daniel made after reviewing the audit/scope, plus answers to the
open product questions. Supersedes the "open decisions" in `PLUGIN-SCOPE.md §9`.

---

> **Design (round 4):** the plugin **copies the OMI design system** by default (Brockmann
> font, `#faf9f5` page, thick 2px borders, gold `#E7CD41` accent). Full tokens in
> **[DESIGN-SYSTEM.md](DESIGN-SYSTEM.md)**; the pricing mockup is re-skinned to it.
> Round-4 also locks the **public-builder abuse controls (§I)** and **terms-signing +
> emailed record (§J)** below.

## A. Locked decisions

| Topic | Decision |
|-------|----------|
| **Client branding** | **Never use client logos.** Agencies misuse logos / break brand guidelines, and owners fixate on that instead of the proposal. Use **client name (text) + October logo** only, plus **one image pulled from the client's website** so they instantly "see themselves" in the proposal. |
| **PDF page size** | **A4 landscape** for global, **US Letter landscape** for US clients. Driven by the same currency/region switch (US ⇒ Letter + USD + no VAT). |
| **PDF engine** | **Server-side**, same approach as the **Architourian PDF generator** → **mPDF**. |
| **Currency / VAT** | Per-proposal setting. Company is **UK-registered** but has a **USD bank account**. US clients ⇒ USD, no VAT. UK/global ⇒ GBP, VAT as applicable. Stops the GB-VAT-on-USD slip. |
| **Pricing table** | Keep it mapped to the **Plan of Work** (mirrors the **RIBA Plan of Work** architects know — clients always ask "how do you work"). Make it **clearer** — see mockup `mockups/pricing-table.html`. |
| **Recurring payments** | **GoCardless Direct Debit** for monthly retainers (Daniel's existing method). **Stripe** for one-off / project payments. **Invoice on request.** |
| **Video hosting** | **Loom** embeds. |
| **Proposal URL** | `octobercomms.com/proposal/<token>` — confirmed. |
| **CRM** | **Build a pipeline in**, modelled on Daniel's Google Sheet (`October Sales Leads Tracker`). Import the existing history. |
| **Subscription pause** | **Yes** — client-controlled pause with the 14-day notice rule (see §G). |
| **Goal** | Produce a proposal **immediately after a call — or with no call at all.** Prospects can self-serve a draft, then book a call to discuss. |

---

## B. Payments — GoCardless vs Stripe

**Short answer: use both, for what each is best at — and abstract them behind one
`OCP_Payments` interface so the proposal doesn't care which rail it's on.**

- **GoCardless** is purpose-built for **bank Direct Debit** (UK Bacs, SEPA, ACH). It is the
  right rail for **monthly retainers**: low capped fees on recurring debits, native
  **mandates**, and first-class **pause / skip / resume** — which maps exactly onto your
  14-day-notice model. This is already how your SG/D retainer is billed, so we keep it.
- **Stripe** *can* also do Bacs/SEPA Direct Debit and subscriptions, at broadly comparable
  Direct-Debit pricing — so technically Stripe could do "the same thing for the same fee."
  But the **mandate + pause + notice UX is less native** than GoCardless, and you already run
  GoCardless. Where Stripe wins is **one-off card payments** (deposits, project fees, the
  IndieWalls/Seilern style single fee) and instant card checkout — so we use Stripe there.
- **Net recommendation:** GoCardless = recurring retainers; Stripe = one-off/project +
  card; invoice-on-request = a manual flag that pauses auto-collection. One payments
  abstraction, two providers, both via webhooks. *(Verify current fee schedules at build
  time — published rates change.)*

---

## C. Server-side PDF — how confident, and how to make it work first-pass

**Confidence: high — but only if we design the proposal *for* mPDF from day one, rather than
trying to make mPDF reproduce an existing InDesign/Figma PDF.** That distinction is the whole
game, and the Architourian generator proves it: it matches its template *exactly*, but the
code is full of mPDF-specific workarounds (no flexbox/grid; columns built with tables or
absolutely-positioned `<div>`s; `<img width=…>` attributes instead of CSS sizing; `<p>`
avoided inside table cells; `:last-child` bugs sidestepped). mPDF renders an **older CSS
subset** — it does *not* run modern layout.

So the honest model is **one content model → two tuned renderers**, not one HTML for both:

- **Web renderer** — modern CSS (flexbox/grid, animation, Loom embeds, interactivity).
- **PDF renderer** — an **mPDF-safe template** authored from the same data: simple block and
  table layouts, embedded fonts, landscape `@page` (`A4-L` / `Letter-L`), `<img>` for any
  graphic. Print-correct headers/footers/page-breaks.

**What you can do to make it land first-pass:**
1. **Design the master template in the mPDF-safe subset** (we author it that way once; every
   proposal reuses it, so there's no per-proposal PDF fiddling — exactly like Architourian).
2. **Embed brand fonts** in the plugin (mPDF needs the font files; this is how Architourian
   ships `ballingermono`). Your "change fonts/colours" requirement = drop font files + set
   token colours.
3. **Avoid the known traps** up front (the list above) so we don't rediscover them per page.
4. **Keep graphics as flat images/SVG-as-img**, not CSS-drawn effects.
5. Could a **different format help?** Yes — that *is* the lever: authoring the template
   natively for mPDF (instead of replicating a pixel-exact existing PDF) is what makes it
   reliable on the first pass. If you ever need pixel-exact modern-CSS PDFs, the alternative
   is a **headless-Chrome** renderer (Gotenberg / Browsershot) which supports full CSS — but
   it needs a Chrome binary on the server (awkward on shared WP hosting), so mPDF is the
   right call given your stack.

---

## D. Claude pricing agent (drafts proposal pricing from your rate)

**Feasible and valuable — built on the Claude API, grounded so it can't say "£10k for a
website."** "Trained" here means *context-grounded*, not fine-tuned:

- **Inputs:** your **hourly rate**, project type, scope signals, region/currency.
- **Grounding (so it stays sane):**
  - A **rate card / pricing matrix** with **min–max bands per service type** (PR, website,
    SEO, retainer, event) that the model **must stay within** — hard guardrails, validated in
    code after the model responds.
  - **Few-shot examples from your real past proposals** ("hundreds of old proposals") so it
    learns *how you scope and price*, not generic agency numbers.
  - Your **Plan of Work stages** as the structure it must fill.
- **Output:** structured **line items** (one-off / monthly / project, hours, amounts) you
  **review and edit** before anything is sent. Never auto-sends.
- **Guardrail tests:** seed cases like "small website" must land in your real band, not £10k.

This both **speeds up proposals** and nudges you to **charge appropriately** — it's an
estimator with your judgement in the loop, not an autopilot.

---

## E. Front-facing "Create your own proposal" app

**Yes — a public builder on the website, two ways in: chat with your Claude agent, or pick
from guided options. Output is an *indicative* proposal + cost range, which feeds the CRM.**

This is the engine for your core goal — a proposal **after a call, or with no call** — then
"if they like it, we hop on a call to discuss."

- **Two modes:** (a) **chat** — the Claude agent (fed your past proposals + rate matrix from
  §D) asks what they need and assembles a draft; (b) **options** — a guided picker (service,
  scope, budget band) for people who don't want to chat.
- **Gating (recommended):**
  - **Pricing page → free & ungated** (transparency, SEO, AI-search visibility).
  - **Custom proposal builder → email-gated** (it's a lead magnet and seeds the CRM record).
  - A reasonable middle path: let them *build and see a range* ungated, **gate the
    saved/downloadable/emailed proposal** behind email — best of both.
- **The "binding" risk is real and handled by framing:** present **ranges, not a fixed
  quote**, with a clear, visible disclaimer — *"Indicative estimate, not a binding quote;
  final pricing confirmed on a short call."* Ranges also avoid anchoring you to a number you
  can't honour. (UK contract-law note for build time: an invitation-to-treat + explicit
  disclaimer keeps it non-binding; the binding artefact is the **signed** proposal later.)
- **Flow:** builder → indicative proposal (web) → email capture → CRM lead created (status
  *Proposal Made*) → you refine in admin → send the real tokenised proposal → call → sign.

---

## F. CRM pipeline (modelled on the Google Sheet)

Build a native pipeline; **import the existing ~285 leads**.

- **Stages** (from your sheet): `Lead In → Contact Made → Proposal Made → Closed Won` and
  `Closed Lost` with **reason** (Declined, No Response, Late Reply, Retracted, Competitor,
  Cost). Closed-Lost reasons are valuable analytics — keep them.
- **Fields:** date, client name, status, **lead source** (Web Search, Contact Referral,
  Publication, Website Referral, Press Coverage, Social, Other) + description, additional
  info, project type, **budget band**, contact name, email, phone, project address/postcode.
- **Auto-links to the proposal lifecycle:** sending a proposal ⇒ *Proposal Made*; client
  accepts ⇒ *Closed Won*; expiry with no response ⇒ prompt to set a Closed-Lost reason.
- **Dashboard:** leads per month per year (your existing Dashboard tab), win rate, win rate
  by source, value won — far more than the sheet shows today.
- **Front-end builder (§E) feeds straight in** as new leads with source attribution.

---

## G. Subscription pause (client-controlled)

**Yes — give clients the feeling of control while keeping your notice rule intact.**

Your model: monthly retainer; payment taken **end of month for the month ahead**; **14 days'
notice** required before a renewal to pause/stop.

- **Pause button in the client portal** (and admin can pause on their behalf — e.g. after a
  client asks you directly).
- **Notice logic:**
  - Pause **inside** the 14-day window before the next charge ⇒ the **next month's payment
    still goes through** (already committed), then **nothing after** — and the UI says exactly
    that: *"Your payment for [Aug] on [date] will still be taken; nothing will be taken after
    that."*
  - Pause **outside** the window ⇒ **no further payments**; cleanly paused.
- **GoCardless** supports pausing/skipping payments on a mandate, so this maps to its API.
- **Resume** any time; status + next-charge date always visible. Clear "what will/won't be
  charged and when" messaging is the thing that makes clients feel in control.

---

## H. Knock-on changes to the scope

- **Wizard:** add a **website-image capture** step (screenshot/choose a hero image from the
  client's site); drop any client-logo handling. Add a **region** switch (US ⇒ Letter + USD +
  no VAT; else A4 + chosen currency/VAT).
- **Payments:** dual-provider abstraction (GoCardless recurring / Stripe one-off / invoice
  flag) — not Stripe-only as in Hillcroft.
- **PDF:** mPDF renderer, landscape A4/Letter, embedded brand fonts, mPDF-safe master
  template (per §C).
- **New surfaces:** public **proposal builder** (§E) + **Claude pricing agent** (§D) + native
  **CRM** (§F) + **pause** (§G). These move from "Phase 3 nice-to-have" into the core product.
- **Phasing (revised):**
  - **P1:** wizard, block library, types, clear pricing table, web page (Loom + animated Plan
    of Work), mPDF landscape PDF, design tokens, CRM with import, status lifecycle.
  - **P2:** GoCardless + Stripe payments, e-sign, pause, follow-ups, dashboard analytics.
  - **P3:** public proposal builder + Claude pricing agent (grounded on past proposals).

---

## I. Public "Create your own proposal" builder — abuse controls

**Yes, there's a real danger** — a public page wired to the Claude API can be (a) **scraped by
bots** that burn your API budget, and (b) **abused as a free general-purpose AI** via prompt
injection ("ignore the proposal, write my essay"). Both are well-controlled with layered
defences; none of them block a genuine prospect:

1. **Options-first, chat second.** The default experience is the **guided picker** (service,
   scope, budget band) — deterministic, no model call. Free-text **chat is the secondary
   path**, so most traffic never hits the API at all.
2. **Bot wall.** **Cloudflare Turnstile** (invisible CAPTCHA) on the builder + you already run
   **Cloudflare** in front of the site, so enable **Bot Fight / WAF rules** there too.
   Honeypot field as a cheap extra.
3. **Email unlock + verification.** Browsing/estimating can stay open, but **the chat agent
   and the saved/downloadable proposal unlock after a verified email** — friction for bots, a
   lead for you (and it feeds the CRM).
4. **Rate limiting.** Per-IP and per-session caps (reuse the `HGD_Rate_Limit` pattern): max
   messages/session, max sessions/IP/day, cooldowns.
5. **Tightly-scoped agent.** A hard system prompt that **only** discusses October's services
   and scoping; it refuses off-topic requests and never returns general-knowledge answers.
   Server-side only — the API key is never exposed; output tokens capped per reply.
6. **Cost ceilings.** Use a **small, cheap model (Haiku)** for the public agent, with a
   **hard monthly API budget cap** that disables chat (falls back to the picker) if hit.
   Cache common answers.
7. **Non-binding by construction.** Show **ranges, not fixed numbers**, with the visible line
   *"Indicative estimate, not a binding quote; final pricing confirmed on a short call."*
   The binding artefact is only the later **signed** proposal (§J). Ranges also stop you being
   anchored to a number you can't honour.

**Net:** options-first + email-unlock + Turnstile + rate limits + a scoped Haiku agent under a
budget cap makes abuse uneconomic while keeping it frictionless for real prospects.

## J. Terms page — sign on acceptance, email the record

**Yes — acceptance requires agreeing to your Terms, and a signed copy is emailed for the
record.** Built into the accept/e-sign step:

- **Versioned Terms** stored in Settings (your standard T&Cs), with optional per-proposal
  overrides. The proposal **snapshots the terms version at send time**, so later edits never
  change what a client agreed to.
- **On accept**, the client must **tick "I agree to the Terms"** (terms shown/linked inline)
  and **type their signature name**. We record an **audit trail**: signatory name, email,
  **timestamp, IP/user-agent, proposal + terms version, and a document hash**.
- **A signed PDF record is generated** (the accepted proposal **+** the agreed Terms **+** the
  signature/audit block) and **emailed to the client and to you (`hello@octobercomms.com`)**,
  and stored against the CRM record for future reference.
- Reuses the proposal token + mPDF document machinery (Hillcroft already e-signs + renders
  on-brand documents); we add the **Terms snapshot, the agree-checkbox gate, and the
  dual-recipient email**.

This makes acceptance a clean, evidenced contract moment — not just a button click.
