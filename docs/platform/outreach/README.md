# Selective Outreach ("Prospecting") — shipped module

Multi-tenant outbound-prospecting for OMI. AI researches and fit-scores
prospects and drafts every message; **a human approves every prospect and every
send.** Nothing leaves the system unreviewed — including follow-ups and replies.
The approval queue is the product. Built against `docs/platform/outreach/PLAN.md`.

Namespaced `prospecting_*` throughout so it never collides with the existing
owned-list `outreach_*` / `leads` features.

## Where it lives

- **UI:** per-client, **Owned → Email → Selective outreach** tab
  (`/clients/:id/seo?tab=email` → `etab=prospecting`). Component:
  `frontend/src/components/SelectiveOutreachPanel.jsx`.
- **API:** `backend/src/routes/prospecting.js` (agency-staff only).
- **Public opt-out:** `backend/src/routes/prospectingOptout.js`, mounted before
  auth at `/api/prospecting-optout` (token-gated).
- **Services:** `backend/src/services/prospecting/` — `research.js` (AI
  sourcing), `score.js` (fit-gate), `draft.js` (message + reply drafting),
  `send.js` (compliance-enforcing send + sequence advancement), `suppression.js`,
  `optout.js`.
- **Schema:** `backend/migrations/160_prospecting.sql` (7 tables).
- **Schedule:** `services/scheduler.js` — dispatch due approved messages every
  15 min (human-paced, respects the per-campaign daily cap); weekly auto-sourcing
  Monday 07:15 (the paid web-search step, kept low-frequency).
- **Model routing:** `services/aiModels.js` → *Selective outreach* group.
  Research + fit-gate see only public company data (safe on DeepSeek); drafting
  stays on Claude for quality.

## The flow

1. **Set up a campaign** — ICP, hard disqualifiers (the guardrail: e.g. "never
   pitch a PR/marketing agency"), booking link, daily cap, a sequence, and a
   **sending identity**.
2. **Prospects arrive** — auto-sourced by AI (weekly or on demand), pasted via
   CSV, or added by hand. Each is fit-scored (`fit | maybe | disqualified`) with
   reasoning and a specific fact to reference. Provenance (where it was found) is
   always shown.
3. **Approve a prospect** → step 1 is drafted into the queue as a *pending*
   message.
4. **Work the approval queue** — read, edit, then **Approve → schedule** (sends
   on the next dispatch tick within the cap) or **Approve & send now**, or skip.
5. **Follow-ups** — after a step sends, the next step is drafted into the queue
   as pending. It still needs approval; nothing auto-fires.
6. **Replies** — log an inbound reply; the sequence stops, and Claude drafts a
   response back into the queue for approval.

## Compliance (enforced, not advisory)

Every send re-checks the guardrails from scratch in `send.js`:

- **Verified identity required.** No send without `auth_ok` (SPF/DKIM/DMARC
  verified) on a dedicated sending domain — never the client's primary domain.
- **Suppression re-checked at send** (not just at scoring), so an opt-out that
  lands after approval, or an edited-and-approved message, can't slip past.
- **Daily cap** per campaign; human-paced dispatch (no round-the-clock bursts).
- **Genuine opt-out** in every message — a natural-language "if you'd rather I
  didn't email again…" line plus the invisible one-click `List-Unsubscribe`
  header (RFC 8058). Honoured instantly and permanently.
- **Sender postal address** appended to every message (CAN-SPAM / PECR).
- **Full audit trail** — who approved, when, what was sent, every opt-out.

## What's external to the software (operational setup)

The code is complete; going live needs three operational steps per client:

1. **A dedicated sending domain + inbox**, separate from the primary, with SPF,
   DKIM and DMARC configured — then mark the identity authenticated in Setup.
2. **Sending transport** — per-identity SMTP creds (`smtp_json`) or the platform
   default transport. (An ESP/warm-up provider can be wired behind the same seam.)
3. **A real booking link** (Cal.com / Calendly) for the campaign.

Sending cannot be exercised from the build sandbox (no outbound mail / DNS); it
validates live on deploy once an authenticated identity exists.
