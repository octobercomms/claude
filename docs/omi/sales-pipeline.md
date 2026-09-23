# Sales pipeline and proposal engine

Goal: get a personalised proposal to the prospect within an hour of the call, and let OMI tell Daniel when to act.

This builds on the brief (`omi-pipeline-brief`, Sept 2026) and on Snapshot Studio, which already handles the homepage report. One `snapshot_leads` row is the pipeline record from the first report through to sign-up.

## The pipeline as built

| Stage | What happens | Who acts | Where |
|---|---|---|---|
| 1. Report tool | Visitor enters a URL. They see the scores, the headline opportunity and five findings without giving anything. Name, company (prefilled from the crawl), work email and an optional "how did you hear about us" unlock the full report. | Automatic | octobercomms.com embed → `/api/public/snapshot` |
| 2. No booking after 48h | One short nudge email from Daniel that names their headline finding and links to booking. It is sent once and never repeated, and never goes to a lead older than 7 days. | Automatic | `runReportNudges()`, runs every 15 min |
| 3. Call booked | Daniel sets the call time on the lead. OMI then writes a call brief: an opening line, 3 talking points with the evidence on their site, qualifying questions, and the likely objection with an answer. | Daniel clicks, OMI prepares | Lead page → Pipeline card |
| 4. Proposal | Daniel types or pastes call notes (Meet notes work). "Draft proposal" re-reads their site and combines it with the snapshot and the notes. It writes the proposal in the ROAR structure, matches proof by sector and problem, and prices Advanced before Basic. Takes about a minute. | Daniel | Lead page → `/proposals/:id` |
| 4b. Approval | One screen shows the proposal exactly as the prospect will see it. Beside it are the recipients, the proof picked and why, the currency, the onboarding fee and a refine box. Nothing is sent until Daniel clicks "Approve and send". | Daniel | `/proposals/:id` |
| 5. Tracking | The prospect gets a link to `/p/:token`. The page logs each opening session (one per browser tab) and counts seconds spent on each section: letter, situation, plan, method, proof, pricing and sign-up. | Automatic | `/api/public/proposal` |
| 6. Alerts | These go to Daniel only; the prospect never receives an automatic message. Opened: an alert at first open. Unopened after 24h: an alert with a check-in line. Opened, no reply after 24h: a talking point based on the section they read most. Cooling (3+ opens over 2+ days): suggests switching channel. | Daniel | Email to `PIPELINE_ALERT_EMAIL` |
| 7. Sign-up | Choose a package, type a name, tick the terms, then go straight to the GoCardless page for that package. The lead becomes "won" and Daniel gets an alert. | Prospect | Proposal page → GoCardless |
| 8. Attribution | "How did you hear about us" is captured at the report gate and shown as a column on the Leads list. | Automatic | `snapshot_leads.referral_source` |

## Stress test of the brief

Where the brief was weak, and what changed as a result.

**1. The 24-hour alert fires after the window has closed.** The brief cites 42.5% of wins landing within 24 hours of the first open, then puts the first alert 24 hours after that open. The window has passed by then. OMI now emails Daniel the moment a proposal is first opened. It is a heads-up, not a chase: if he was going to call them that day, that is the time. The 24-hour alert still fires and carries the section-dwell talking point.

**2. "Send before the call ends" is the wrong target.** A proposal that arrives while you are still talking reads as a template, whatever it says. The call notes are also the richest input for personalisation, so the target is **within the hour after the call**. That is still well inside the 24-hour figure the brief relies on. The flow is: notes during the call, draft in about a minute, a two-minute read, then send.

**3. Proof is the real bottleneck, not speed.** The library holds 5 testimonials, 4 credentials and **0 case studies**. Only two testimonials are from architects, so every architecture proposal will pick Scenario Architecture and every retail proposal will pick Falcon or Case. "Matched" proof from a pool of five is a default. Before this goes live:
- Write 2 case studies for each core sector (architecture, interiors/residential, furniture/retail, hospitality). That is 8 in total.
- Structure each one as problem, what October did, and the result in numbers ("3 national titles in 6 months", "enquiries from SW postcodes up from 1 in 10 to 4 in 10").
- Get 2 more architect testimonials that name a result, not only a good experience.

**4. The ROAR proposal priced a different offer from the one on the website.** ROAR was quoted £2,500 onboarding plus £1,450/month. The Earned Reach page lists Basic at 1,800/month and Advanced at 2,500/month. A prospect who checks the site after reading the proposal sees a mismatch, which undermines the "fixed foundation, no surprises" message. The engine now always prices the two published tiers, with an optional one-off onboarding fee. Decide whether £1,450 was a one-off or should become a tier. The website also shows $ to a mostly UK audience; proposals default to £.

**5. Cut the boilerplate.** Pages 12-17 of the ROAR proposal describe PPC, CRO, email and social. Those services are not in the Earned Reach package, and the pages dilute a proposal whose strength is its specific diagnosis. The SEO page includes the line "In this guide, expect to learn how to do both", which comes from Moz's beginner's guide to SEO. A sharp reader will spot it. The new format drops those pages. Its length is set by the content about the prospect, not by service descriptions.

**6. The stats are directional, not proof.** The Better Proposals figures come from a vendor and are correlational: fast senders also tend to be more organised and to hold warmer deals. At 4-6 proposals a month, October needs roughly 6 months to learn anything from its own data. Leave the thresholds at 24h (set through env) and review them after 30 sent proposals. The Proposals tab shows sent, opened, accepted and time to open for that review.

**7. More gate fields cost conversions.** The gate went from 1 field to 4. Company is prefilled and referral is optional, so the visitor types two new things. Compare the unlock rate for the 30 days before and after. If it drops by more than a quarter, make name optional again.

## What still needs Daniel

1. **GoCardless:** create a hosted payment page (plan) for each package and set `GOCARDLESS_URL_ADVANCED` and `GOCARDLESS_URL_BASIC`. Without them, an accepted proposal shows a thank-you screen and Daniel follows up by hand.
2. **Case studies:** add them in Settings → Biz dev → Proof library, and check the tags on the 9 seeded items.
3. **Terms:** make sure `PIPELINE_TERMS_URL` points to terms that cover a monthly retainer paid by Direct Debit.
4. **Alert inbox:** set `PIPELINE_ALERT_EMAIL` if alerts should go somewhere other than `ALERT_EMAIL`.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PIPELINE_ALERT_EMAIL` | `ALERT_EMAIL` | Where pipeline alerts go |
| `PIPELINE_FROM` / `PIPELINE_REPLY_TO` | platform sender | From and reply-to for proposals and nudges |
| `PIPELINE_CURRENCY` | `£` | Default proposal currency |
| `PIPELINE_TERMS_URL` | octobercomms.com/terms-and-conditions/ | Linked from the accept step |
| `PIPELINE_CONTACT_EMAIL` | hello@octobercomms.com | "Ask a question first" link |
| `GOCARDLESS_URL_ADVANCED`, `GOCARDLESS_URL_BASIC`, `GOCARDLESS_URL` | none | Mandate page after acceptance |
| `PIPELINE_ALERT_UNOPENED_HOURS` / `PIPELINE_ALERT_OPENED_HOURS` | 24 / 24 | Decay alert thresholds |
| `PIPELINE_NUDGE` | on | Set to `0` to stop the Stage 2 nudge |
| `PIPELINE_NUDGE_HOURS` | 48 | Hours after the report unlock before the nudge |
| `SNAPSHOT_BOOK_URL` | octobercomms.com/book/ | Booking link in the nudge and on the proposal page |

AI models: the proposal draft runs on Opus by default and the call brief on the global default. Both can be changed in Settings → AI models under "Sales pipeline".

## Phase 2 (not built)

In order of return:

1. **Pull Meet notes automatically.** Gemini "Take notes for me" writes a Google Doc to Drive after each Meet. OMI already holds a Drive scope. Match the doc to the lead by attendee email and fill in the call notes, which removes the only manual paste in the flow.
2. **Detect bookings.** Add `calendar.readonly` and poll every 15 minutes for events whose attendee email matches a lead. That sets `call_at` and triggers the brief, so there is no "Mark call booked" click.
3. **Detect replies.** Reuse the IMAP poller in `outreachReplies` to spot a reply from the recipient's address and mark the proposal replied. Until then, "Mark replied" is manual and the alerts assume no reply.
4. **GoCardless Billing Requests API.** Prefill the customer's name and email and receive the mandate webhook, so "won" means the mandate is live rather than "clicked accept".
5. **Client portal space on sign-up.** Create the `clients` row and a folder when the mandate completes.

## Code map

- `dev/platform/backend/migrations/183_sales_pipeline.sql`: lead columns, `proof_items` (seeded), `proposals`, `proposal_views`
- `dev/platform/backend/src/services/proposals.js`: brief, generate, match, send, tracking, alerts, nudge
- `dev/platform/backend/src/routes/proposals.js`: admin API at `/api/proposals`
- `dev/platform/backend/src/routes/publicProposal.js`: public API at `/api/public/proposal`
- `dev/platform/frontend/src/components/proposal/ProposalDocument.jsx`: one renderer shared by the preview and the live page
- `dev/platform/frontend/src/pages/ProposalPublicPage.jsx` (`/p/:token`), `ProposalEditorPage.jsx` (`/proposals/:id`), `ProposalsPage.jsx`, `ProofLibraryPage.jsx`
- `SnapshotStudioPage.jsx`: Pipeline card (contact, referral, call, brief, notes, draft proposal)
