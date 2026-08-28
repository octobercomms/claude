# OMI Selective Outreach — build plan

A multi-tenant outbound-prospecting module for OMI. AI researches and fit-scores
prospects; a human approves every prospect and every message before anything
sends; approved prospects move through a drafted email sequence; replies come
back as AI-drafted responses a human approves. The **approval queue is the
product** — automation does sourcing, scoring and drafting; a person always owns
the send decision.

Derived from the OMI Selective Outreach brief (the TCPR case study) and the
design conversation that followed. This is the spec to build against; no code has
been written yet.

---

## Design principle (non-negotiable)

Every prospect and every message passes an approval gate before it leaves the
system. Nothing sends unreviewed — including follow-ups and replies. This is the
core constraint, not a setting. It is also the strongest deliverability and
compliance control we have.

The failure mode we are explicitly rebuilding *away from* (TCPR): volume over
judgement — no fit-check before send, rotating fake personas across throwaway
domains, a fake "always free" calendar, templated replies that ignored what the
prospect actually said. We keep the sound mechanics (qualify, warm with a real
credibility asset, offer a clear next step) and drop the volume-over-judgement.

## Locked decisions (from the design conversation)

1. **Multi-tenant / client-facing.** Each client runs their own outreach. October
   is simply tenant #0 (an ordinary client record) using its own instance — no
   separate org-level copy, one code path.
2. **Placement.** Per-client workspace, under **Owned → Email** as a distinct
   **"Outreach"** tab — co-located with email tooling but logically separate from
   owned-list/newsletter email (different reputation, compliance basis and sending
   identity; never share a sending domain with the client's good list).
3. **Replies are AI-drafted, not auto-sent.** An incoming reply produces a
   Claude-drafted response that re-enters the same approval queue. Same gate,
   applied to replies. No auto-responder.
4. **Single real identity per sender.** One real name per sending domain. Multiple
   domains are allowed for **capacity/isolation only**, never to run different
   personas (the TCPR move).
5. **Real calendar only.** Availability pulled from the sender's connected
   calendar. If there's no real slot, show none — never synthetic availability.
6. **Genuine, natural-language opt-out.** A human line ("if you'd rather I didn't
   email again, just say and I'll take you off"), honoured instantly and
   permanently, plus the invisible `List-Unsubscribe` one-click header for mailbox
   providers. Low-key and personal — but real. An easy opt-out is what *prevents*
   spam complaints, which are what actually destroy domain reputation.
7. **Model routing.** Research/scoring can run on the cheaper model (DeepSeek) via
   the existing Settings → AI models switch, since it only sees public company
   data. Drafting stays on Claude for quality. Fit-scoring sees no client-private
   data.

## Architecture & reuse

Build on OMI's existing stack (Node/Express, React, Postgres, Hetzner, **n8n**,
Claude via `services/claude.js` with per-feature model routing). Reuse, don't
reinvent:

| Need | Reuse from OMI | New |
|------|----------------|-----|
| Prospect list + scoring | `lead_scoring`, `lead_scrape`, `contact_tidy`, Snapshot Studio leads | the **fit-gate** (disqualifier rules) + per-campaign criteria |
| Drafting | `outreach_write_sequence`, Claude drafting path | reply-drafting into the queue |
| Reply classification | `outreach_classify_reply` | route classified reply → drafted response → queue |
| Sending / sequences / follow-ups | **n8n** flows | follow-ups + replies re-enter the queue, not auto-fire |
| Model routing / cost | `aiModels.js` (`callClaude`), cost log | `outreach_research` / `outreach_reply_draft` features |
| Per-notice chat / approval-list UI patterns | Tender agent queue + "Start with Claude" | the outreach approval queue |

The genuinely new build is narrow and that's where the value is: **fit-gate,
approval queue, reply-drafting, per-client sending identity, and the
compliance/deliverability layer.**

## Deliverability & sending identity

- **Dedicated sending domain(s), separate from the primary.** Never send cold
  from the client's main domain (it carries their real mail). Ring-fence outreach
  reputation on its own domain/subdomain.
- **Authentication required before a campaign can send:** SPF, DKIM, DMARC
  verified. Block send if not green.
- **Warm-up** before first real send; ramp volume.
- **Per-day / per-domain rate caps** and human-paced scheduling (no round-the-clock
  bursts).
- **List hygiene:** verify addresses, drop role/catch-all/undeliverable before a
  prospect is eligible.
- **More domains = capacity/redundancy only.** Each domain = one real sender
  identity. No persona rotation.

## Compliance layer (first-class, enforced — not advisory)

Because this is provided *to clients*, October carries vendor exposure; the
product must enforce the guardrails so no tenant can turn it into a spam cannon.

- **Legal basis:** B2B cold email is permissible under UK/EU (GDPR + PECR,
  legitimate interest, corporate recipients) and US (CAN-SPAM) *with conditions*.
- **Opt-out:** genuine, easy, honoured instantly + permanently; natural-language
  visible line + `List-Unsubscribe` header (Google/Yahoo bulk-sender rules).
- **Suppression list** checked at **both scoring and send** — existing clients,
  active prospects, prior opt-outs, and any disqualifying-category entity can never
  be contacted, even on an edited-and-send.
- **Sender identity + physical postal address** in every message.
- **Rate caps** and auth checks gate the ability to send at all.
- **Full audit trail:** who approved, when, exact content sent, opt-outs.

## Data model (sketch)

- `outreach_campaigns` — client_id, ICP, scoring criteria, sending identity, status.
- `outreach_prospects` — campaign_id, company/contact, source (auto|csv, tagged),
  fit_score, score_reasoning, state (new|approved|dismissed|sequenced|replied|
  opted_out), suppression flags.
- `outreach_messages` — prospect_id, step, direction (out|in), draft, state
  (pending|approved|sent|skipped), approver, sent_at, content_hash.
- `outreach_suppression` — client_id, email/domain, reason, added_at (permanent).
- `outreach_sending_identities` — client_id, domain, from_name/address, auth status.
- Full audit rows on every approve/send/opt-out.

## Phased build (shippable stages)

1. **Queue + manual source (the core).** CSV import (tagged), fit-scoring with
   disqualifier rules, the approval queue UI (prospect, score, reasoning, draft,
   source; approve/edit/reject/skip; friction before batch), suppression list,
   audit trail. Single connected inbox, manual send. *Ships the risky/valuable part
   first.*
2. **Sequences + follow-ups via n8n.** Approved sends fire through n8n; follow-ups
   re-enter the queue. Rate caps, sending-identity + auth checks, opt-out +
   `List-Unsubscribe`, sender address enforced.
3. **Replies.** Inbound replies classified, AI-drafts a response into the queue;
   calendar integration (real availability; booking link only when a real slot
   exists).
4. **Auto-sourcing.** Claude/DeepSeek research to propose prospects from an ICP,
   drawing on OMI connector signals where available; everything still lands in the
   approval queue.
5. **Learning + metrics.** Rejections feed scoring criteria over time; reply/booked
   rate by fit-score band validates the model.

## Success metrics

- Approval rate (a low rate = tighten scoring, never lower the send bar).
- Reply rate + booked-call rate, segmented by fit-score band.
- **Zero** outreach reaching a disqualifying-category entity (the TCPR test).
- Deliverability health per sending domain (bounce/complaint/spam rates).

## Open questions to settle before Phase 1

- **Launch ICP** — recommend a narrow vertical you can eyeball (e.g. architecture/
  design practices), where the disqualifier ("don't pitch an agency") is easy to
  encode and demo.
- **Prospect source at launch** — recommend manual CSV first; auto-sourcing as
  Phase 4. Don't block the queue on solving sourcing.
- **Sending infra** — who provisions/owns the dedicated domains + inboxes per
  client (client-connected via SMTP/OAuth vs October-provisioned), and the
  warm-up/ESP choice.

_Status: **built** (all phases). Shipped as the `prospecting_*` module — see
`docs/platform/outreach/README.md` for what landed and how it maps to the phases
above. Sending goes live once a client's dedicated domain is authenticated
(SPF/DKIM/DMARC) and its identity is marked verified._
