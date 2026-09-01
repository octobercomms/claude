# Press Outreach 2.0 — build plan

Make OMI's earned/press email outreach genuinely usable for October: paste a
release, let Claude pick and personalise for the right journalists, send to
thousands safely, adapt follow-ups to who opened, measure everything, and keep
the media database continuously true — with Claude (Opus) as the account
executive that runs it.

Derived from Daniel's spec (four messages) and a full audit of the current
system. **Most of the sending engine already exists** — this is largely
surfacing, smartening, and a few new brains, not a rebuild.

---

## North star

**Speed and ease for the operator.** Dump a release + some names, and Claude does
the sorting, targeting, personalising, sending, chasing and record-keeping.
Powerful but never a black box — every AI action is previewable and undoable.

**Model:** route press personalisation + all database-hygiene reasoning to
**Claude Opus** (they're on Sonnet today; the pitch generator isn't even
cost-logged). Everything goes through `services/claude.js` `callClaude` with a
named feature so it's model-routable in Settings → AI models and cost-logged.

## Locked decisions

1. **Opt-out is a preference centre, not a binary.** The unsubscribe link opens a
   public page where the journalist can (a) **update their own details** (feeds
   the media DB), or unsubscribe from (b) **just this campaign**, (c) **just this
   client**, or (d) **all October email**. Suppression therefore has three
   scopes: campaign / client / global.
2. **Placement: Earned is the primary home**, with a link kept in Owned → Email
   so existing muscle memory still works.
3. **Sending infra: build the software** (pacing, warm-up, caps, per-day dedupe);
   **October owns the AWS SES quota + verified domains** for the volume.
4. **Extend the existing outreach engine** (`outreachSender`, mailboxes,
   tracking, suppression) — it is more complete for sending than the newer
   Selective Outreach module. Do NOT swap engines.
5. **Global journalist database.** Press campaigns target the whole contact
   library (filter by tag/beat/outlet/title/location), not just client-linked
   contacts.

## What already exists (from the audit — reuse, don't rebuild)

- SES (API) + SMTP delivery, **per-mailbox rotation, warm-up ramp, daily caps**
  (`outreachSender.js`, `outreachMailboxes.js`).
- **Opens + clicks already tracked** — pixel + link-rewrite; `outreach_sends.opened_at`
  and `outreach_clicks` (`outreach.js:47,67`). Not surfaced at campaign level.
- **Deliverability**: `List-Unsubscribe` one-click header, HMAC unsubscribe,
  per-client unsubscribe, reply detection that stops follow-ups (IMAP + Claude
  classify), bounce suppression.
- **Press email already renders as a 600px centred template** (`pressRelease.buildEmailHtml`).
- **Contact library** with dedupe-scan, merge, tidy, enrichment fields, tags,
  email verification, and byline-check plumbing (migrations 077/079/080; PR
  services `prEnrich`, `prArchive`, `prLinkCheck`).

## Gaps the audit confirmed

- Press contact selection is hard-limited to client-linked contacts.
- Follow-ups are pre-materialised, read-only, fixed cadence (day 0/5/10/16); no
  open-based branching; not editable per email.
- No campaign-level opens/clicks dashboard, no test-send, no unsubscribe/spam
  list in the press UI.
- The wizard shows raw `body_html` in a monospace box (looks like "HTML") instead
  of a rendered press-release preview — though the *sent* email is formatted.
- `press.js:317` calls a non-existent `outreachSender.processPending` → step-1
  waits for the ≤3-min cron; no true "send now".
- `opened_at` is a single timestamp → no repeat-open count yet.

---

## The one-paste autopilot (the front door)

Paste the URL and walk away — Claude runs the whole setup like an account exec,
in the background (minutes is fine), then hands over a review screen. Decision:
**full setup → one-click approve → sends on pacing** (nothing sends unreviewed,
but approval is a single action, not per-email).

The autopilot pass, per release:
1. **Reads the release** and loads what it already knows — October, the client,
   the client's briefing/brand.
2. **Sources the audience** from the whole journalist DB — who fits THIS story by
   beat / outlet / coverage history — with a visible reason per pick.
3. **Writes every email deeply personal.** The non-negotiable quality bar:
   *super relevant and personal, never a generic AI version with a name swapped
   in.* Each pitch references something true about that journalist's actual
   recent coverage. Runs on **Opus**, researches each recipient. Personalisation
   depth is a first-class quality gate, not a nice-to-have.
4. **Sets the sequence + timings.**
5. **Review screen**: suggested recipients (+ why), every drafted email, all
   editable; one-click approve → sends on pacing.

## The 24/7 watcher — the exec that never sleeps

- Continuously watches opens/clicks and **alerts the AM when a journalist shows
  real interest** — read as a signal blend (default: 3+ opens, OR any link click,
  OR two opens within an hour), with a per-client threshold slider. Not a single
  static "10 opens".
- Standout journalists are flagged **"warm"** and pushed to the **client
  dashboard coverage/PR area** (decision) so the client sees live interest
  immediately.
- Needs repeat-open counting (Phase 4) + an interest-scoring pass + the
  client-coverage handoff.

## Preview / test / import / export — everywhere

Consistent affordances across the flow:
- **Preview**: wizard body, each journalist's email, whole-campaign at a glance,
  the audience list.
- **Test-send**: from the campaign, from a single journalist's draft, and a
  "send me all N as a test batch".
- **Import**: paste-and-sort on the campaign audience AND the master contacts list.
- **Export**: the audience, send results/analytics (CSV), the media list.

## Phased build

### Phase 1 — Make the press flow usable
Maps: #7 (preview/test), #8 (press-release formatting), #9 (delays), #12 (edit all
emails), #13 (first name in follow-up subject), #14 (name in every email).
- Rendered press-release **preview** in the wizard (replace raw-HTML textarea with
  a WYSIWYG/rendered view + a "show HTML" toggle for power users).
- **Preview** (per-journalist) and **Test-send** buttons in `PressCampaignDetail`.
- **Editable per-step** subject + body for all 4 steps (persist to
  `outreach_sequences` / per-recipient overrides), with `{{first_name}}` tokens.
- **Configurable delays** per step (replace hard-coded 0/5/10/16).
- Real **"send now"** for step 1 (fix the `processPending` no-op).

### Phase 2 — Open-aware follow-ups
Maps: #10, #11.
- Resolve follow-up content at **send time** by the prior email's open state:
  - **Opened** → the real next-stage follow-up.
  - **Not opened** → resend email 1 with a **fresh subject** (up to 4 subjects /
    4 attempts).
- Reply or bounce still cancels the remainder (existing guards).
- Store per-step: `subject_if_opened`, `subject_if_not_opened[]`, and a flag for
  "resend first body when unopened".

### Phase 3 — Reach thousands, safely
Maps: #5, #15, #21, #22 + deliverability additions.
- Target the **global library** with tag/beat/outlet/title/location filters.
- **Staggered pacing** for big lists: per-campaign throttle + jitter, respecting
  per-mailbox warm-up/caps (replace flat `LIMIT 25`/tick).
- **One press email per person per day**: if two releases are queued to the same
  journalist, hold the second *for that person only* until tomorrow (not the
  whole send).
- Bounce/complaint hardening; **send-window / timezone** (business hours, not 3am).

### Phase 4 — Analytics, lists & the 24/7 watcher
Maps: #16, #17, #18, #19, #20 + the interest watcher.
- Campaign dashboard: **open %/#, click %/#**; sortable **who-opened-how-many /
  who-clicked-what** table.
- **Repeat-open counting** (add `outreach_opens` events or an `open_count`).
- **Unsubscribes** list and **spam / do-not-contact** list, with manual add.
- **Interest watcher**: score engagement continuously; **alert the AM** on real
  interest; flag journalists **"warm"** and push them to the **client dashboard
  coverage/PR area**. Per-client threshold slider (default: 3+ opens / any click /
  two opens within an hour).

### Phase 5 — Claude, keeper of the media DB
Smart import + hygiene.
- **Paste-and-sort import (Opus)**: dump anything (messy list, spreadsheet,
  signatures) → Claude extracts contacts → **dedupe/merge/update** the master
  list → attach to the campaign → undoable "12 added, 3 updated, 1 skipped"
  summary.
- **Intelligent hygiene**: fuzzy dedupe (same person across email/name/outlet
  variants), field-level merge with history preserved, enrichment, staleness
  flags, relationship memory (last pitched/opened/replied).

### Phase 6 — Claude, the account executive
The always-on researcher.
- Monitor **RSS feeds + bylines** per outlet/journalist.
- Detect **new writers, leavers, "no longer writes here", moves** (same name at a
  new outlet → update record + reactivate), and **leave/maternity gaps**.
- **No byline in 6 months → auto-mark inactive**; reappears elsewhere → update
  outlet.
- Scheduled; proposes changes for review (or auto-applies low-risk ones with an
  audit trail). Builds on `last_byline_check` / `archive_suggested` + PR enrich.

## Compliance & deliverability (enforced)

- Preference-centre opt-out (campaign/client/global) + `List-Unsubscribe` header,
  honoured instantly.
- Suppression checked at enqueue **and** at send.
- Bounce + complaint auto-suppression; complaint-rate alerting per domain.
- Sender identity + postal address in every email; full audit trail.
- Warm-up + rate caps gate the ability to send at volume.

## Success metrics

- Time from "paste release" → "sent to the right 2,000" (should be minutes).
- Open %, click %, reply %, by campaign and by beat.
- Bounce % and complaint % per sending domain (health, with a pause line).
- Media DB freshness: % contacts verified/active, moves caught, dead records
  retired — trending up with zero manual effort.

### Phase 7 — The one-paste autopilot (capstone)
Depends on Phase 3 (global targeting) + deep per-recipient personalisation.
- Background orchestration: read release → source audience (with reasons) →
  research + write each email on Opus → set timings → review screen → one-click
  approve → send on pacing. See "The one-paste autopilot" above. The felt
  centrepiece; built once its dependencies land so the magic is real, not shallow.

_Status: plan agreed (decisions locked, incl. one-paste autopilot + 24/7 warm
watcher → client dashboard). Building in phases; each phase ships. Phase 1 done._
