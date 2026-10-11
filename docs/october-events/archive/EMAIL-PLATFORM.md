# ADF — Email / SMS / Chat platform (replacing Brevo)

**Status:** proposal for review · **Date:** 2026-06-10 · **Build:** not started (scope only)

Replace Brevo with an in-plugin messaging stack on **Amazon SES** (email) and **AWS
End User Messaging** (SMS), with a drag-and-drop campaign builder and native contact
management driven from the data the plugin already holds. Live chat moves to
**self-hosted Chatwoot** (last). Primary driver: **dramatic cost reduction** (SES is
~$0.10 / 1,000 emails vs Brevo plan pricing) and **no more manual contact imports**.

## Decisions locked
- **Email transport:** Amazon SES (dedicated **ADF AWS account** for isolated billing +
  sender reputation).
- **SMS:** AWS End User Messaging (SMS).
- **Scope:** full rebuild — native contacts/lists/segments + SES sending + drag-and-drop
  campaign builder + deliverability ops + analytics.
- **Live chat:** self-hosted **Chatwoot**, injected as a widget — **last** on the list.
- **Site mailer:** October Events becomes the site's `wp_mail` transport + email log, so a
  cluster of single-purpose plugins (Gravity SMTP, Check & Log Email, the two Brevo
  plugins) can be retired.
- **Safety rail:** keep a **pluggable transport** with **Brevo as an instant fallback**
  during transition; never rip Brevo out on day one.

## Why this is worth it (and the honest risk)
Beyond the cost saving, the real prize is the **Claude co-pilot** (see below) — briefing
an AI to draft a finished, editable campaign grounded in live festival data, which no
off-the-shelf tool (Brevo, Mailchimp) offers.

The savings are real. What Brevo actually sells you is **deliverability operations** —
the invisible work that keeps mail out of spam. On SES we inherit that, so the build is
**80% deliverability plumbing, 20% pretty builder.** Done right = cheap and reliable;
done lazily = cheap and in spam. The plan below front-loads the plumbing.

## Architecture
```
  WordPress (ADF plugin) ── Mailer interface ──┬─ SES driver  (default)
        contacts/lists/segments                └─ Brevo driver (fallback)
        campaigns + builder (MJML)
        send queue + throttle
        ▲   ▲                         SNS  ◀── SES bounce/complaint/delivery events
        │   └─ open pixel / click redirect ──► analytics
        └─ SMS interface ── AWS End User Messaging (SMS)   [+ existing Brevo SMS fallback]

  Chatwoot (self-hosted on ADF AWS) ── widget injected by plugin (settings field)
```
- **One source of truth stays WordPress.** Contacts are derived/unified from data the
  plugin already owns (accounts, ticket purchasers, volunteers, submitters) — **this is
  what kills the manual Brevo import.**
- **Mailer/SMS are interfaces** with swappable drivers so we can A/B SES vs Brevo per
  message and fall back instantly.

**Where it runs — engine in the plugin, UI in the platform.** Consistent with the
"platform = front-end on WP, no sync" decision: the email **engine** (SES sending,
contacts, campaigns, send queue, bounce/suppression, the Claude co-pilot) lives in the
**plugin** on WordPress — that's where the data and connectors already are. The
**campaign-builder UI** is rendered in **platform.atlantadesignfestival.net** (a simpler
version can also live in wp-admin); it talks to the plugin's REST API. So it's "UI in the
platform, engine in the plugin" — no second backend, no sync.

**Media library — one library, surfaced via REST.** The platform has no media store of
its own; it reads/writes the **same WordPress media library through the API** (core
`GET/POST wp/v2/media`, or a plugin wrapper with our own permissions). The builder's image
picker lists media from that endpoint and drops the image's **public uploads URL** into
the block; uploads from the platform POST straight back into the WP media library — one
place, no copying, no sync. WordPress serves uploads from public `https` URLs, which is
exactly what email needs (image `src` must be publicly reachable). Caveat: platform users
authenticate to WP (the magic-link/token), and uploads must stay publicly fetchable (no
auth/CDN rule that blocks email clients).

## Data model (new tables, `adf_` prefixed)
- `adf_contacts` — unified person record (email, name, phone, sms_opt_in, source,
  consent/optin timestamp, status) de-duped on email; back-filled from accounts/orders/
  volunteers/submissions.
- `adf_lists` + `adf_contact_lists` — static lists; **segments** = saved filters
  (e.g. "2025 ticket buyers", "confirmed volunteers", "directory partners").
- `adf_campaigns` — name, subject, MJML/HTML body, audience (list/segment), schedule,
  status (draft/scheduled/sending/sent), stats.
- `adf_messages` / `adf_message_events` — per-recipient send + events
  (delivered/open/click/bounce/complaint/unsub) for analytics.
- `adf_suppression` — global do-not-send (hard bounces, complaints, unsubscribes),
  honoured on every send.

## Deliverability operations (the part that matters)
- **Domain auth:** DKIM + SPF + **DMARC** on `atlantadesignfestival.net`. Use **separate
  subdomains** — e.g. `news.` (marketing) and `mail.` (transactional) — so a marketing
  reputation dip never blocks ticket delivery.
- **Warm-up:** ramp volume over ~2 weeks; warm with **engaged transactional** traffic
  (ticket confirmations) first, big marketing blasts last. Shared SES IP pool at our
  volume (no dedicated-IP warming needed yet).
- **Sandbox → production:** SES starts at 200/day to verified addresses; request
  production access once, citing our bounce/complaint handling. Raise limits as volume
  grows.
- **Bounce & complaint handling (mandatory):** SES events → **SNS** → auto-add to
  `adf_suppression`. Keep bounce <5%, complaint <0.1% or AWS throttles/suspends.
- **Unsubscribe:** one-click `List-Unsubscribe` header + hosted unsubscribe page +
  honour SES account-level suppression. Physical address in footer (CAN-SPAM), consent
  records (GDPR).
- **Monitoring:** CloudWatch alarms on bounce/complaint rates; documented "if AWS pauses
  us" runbook (flip Mailer to Brevo).

## Campaign builder
- **GrapesJS** with the **MJML newsletter preset** → responsive email that survives
  Outlook. Rendered in the **platform UI** (engine stays in the plugin; see Architecture).
- **Images from the WordPress media library** via the REST media endpoint (`wp/v2/media`
  or a plugin wrapper) — picker lists media, block stores the public uploads URL; uploads
  go back into the same library. No separate media store.
- Save reusable templates; preview; send test; schedule; pick list/segment as audience.

## AI campaign drafting (Claude co-pilot) — the differentiator

The thing Brevo and Mailchimp **don't** do: brief an AI on what the email needs and have
it draft the whole thing, structured and ready to edit. This is the main reason building
our own is worth it.

**How it works.** In the campaign wizard there's a **chat panel**. You brief Claude in
plain language — purpose, audience, the sections to include, key info, tone. Claude
returns a **fully-built draft as editable builder blocks** (not prose): subject line +
preheader, headline, body sections, CTA buttons, and **image blocks as placeholders**
(with suggested alt text, caption, and size). It loads straight into the GrapesJS/MJML
canvas, where you swap in real images from the media library and drag/drop/edit. Then
it's a **conversation** — "make section 2 punchier", "add a sponsor thank-you", "shorten
the intro" — and each turn edits the draft in place.

**Structured output, not a text dump.** Claude emits the builder's **block/MJML schema as
JSON** (via tool-use / structured output), validated against the schema and auto-repaired
if malformed, so the result is always draggable sections — never a wall of text to
reformat.

**Grounded in live festival data (the moat).** Because the plugin owns the data, Claude
gets **tools** to pull real facts while drafting — `get_upcoming_events` (confirmed only),
`get_ticket_link`, `get_recent_stories`, `get_sponsors`, `get_event_sessions`. So
"draft this month's newsletter" auto-fills with the *actual* confirmed events, working
ticket links, and this week's stories. This is exactly what the existing monthly-digest
job assembles — the co-pilot turns that data into finished copy.

**"Learns about the festival over time" — what that really means.** Not model training.
It's a **growing, editable knowledge base + example library injected as context** on every
request:
- the **brand/voice guide** + example pieces we already built for the AI Stories connector
  (reused here),
- **festival facts** (dates, venues, ticket types, sponsors, recurring events),
- a **library of past sent campaigns** as few-shot examples (every email you approve and
  send adds to it).
Over time that corpus grows, so drafts sound more like ADF and need less editing.
**Prompt caching** keeps the cost of that large, stable context down.

**Guardrails.**
- AI drafts are **always editable and never auto-sent** — it produces a draft in the
  builder, full stop.
- It must **not invent facts**: anything it can't verify from the tools (a price, a date,
  a venue) becomes a **visible `[TODO: confirm …]` placeholder**, not a hallucinated value.
- It always includes the required **unsubscribe / footer / preheader** tokens so drafts
  stay compliant and deliverable.
- Links come from the tools (real ticket/event URLs), never fabricated.

**Reuses what exists:** `ClaudeConnector` + the tone-of-voice training (system prompt +
examples) from the AI Stories connector; this extends it with structured block output,
data tools, and the campaign example library.

## Site-wide mailer + email log (retire SMTP / log / Brevo plugins)

October Events becomes **the site's outgoing mail transport**: it overrides WordPress
`wp_mail()` to route *all* site email (not just our own) through SES via the same
pluggable Mailer, and records every send in a built-in **email log** (status, to,
subject, opens/bounces). This lets us retire a cluster of single-purpose plugins:

| Plugin today | Replaced by |
|---|---|
| **Gravity SMTP** (outbound transport) | OE as the site `wp_mail` → SES transport |
| **Check & Log Email** (test + log) | OE's built-in email log + "send test" |
| **Brevo – Email/SMS/Chat** | OE sending + native contacts (+ Chatwoot for chat) |
| **Add-on Brevo for Gravity Forms** | native contacts (form entries land in OE) |

Notes:
- Implemented as a small **`pre_wp_mail`/`wp_mail` override** behind a setting (so it can
  be toggled off instantly, with the host's default mail as the ultimate fallback).
- Honours the same suppression list, so site email also respects unsubscribes/bounces.
- The two **Brevo** plugins and the **Gravity Forms → Brevo** add-on fall away once
  native contacts land (phase 2); **Gravity SMTP** and **Check & Log Email** fall away as
  soon as this mailer override ships.

## SMS on AWS
- **AWS End User Messaging (SMS)** for reminders (replaces the Brevo SMS we wired; keep
  Brevo SMS as fallback driver).
- ⚠️ **US A2P requires 10DLC registration** (brand + campaign) regardless of provider —
  needs an origination number; budget setup time. Built-in **opt-out (STOP)** handling.

## Live chat (last)
- **Chatwoot**, self-hosted on the ADF AWS account (Docker). Open-source, omnichannel,
  free — another cost saving. Real-time chat needs websockets, which **20i shared hosting
  can't do**, so it must NOT be built into the plugin.
- The plugin just exposes a **"Live chat widget" setting** that injects the Chatwoot
  script site-wide — swapping providers is a paste, not a deploy.

## Migration from Brevo
- Export Brevo contacts + lists → import into `adf_contacts`/`adf_lists` (de-duped),
  carrying consent/opt-in status and suppressions.
- Map the existing transactional triggers (account_welcome, ticket_delivery, etc.) to
  SES-sent templates; keep Brevo template IDs until cutover.
- Run **dual-capable** (SES primary, Brevo fallback) through one event cycle before
  retiring Brevo.

## Phasing (build order)
1. **Mailer/SMS abstraction** + **SES transactional** behind a flag, Brevo fallback
   (warm-up begins with engaged transactional). Includes the **site-wide `wp_mail`
   override + email log** → retires Gravity SMTP and Check & Log Email immediately.
2. **Native contacts/lists/segments** from existing data — **kills the manual import**
   and removes the two Brevo plugins + the Gravity-Forms→Brevo add-on.
3. **Deliverability spine** — SNS bounce/complaint ingestion, suppression, one-click
   unsubscribe + List-Unsubscribe. (Gate before any bulk send.)
4. **Campaign builder** (GrapesJS/MJML + WP media) + **bulk sender** (queue/throttle to
   SES rate limits) + **open/click analytics**.
5. **Claude co-pilot** — structured block drafting + data tools + brand/example context
   (layers onto the builder from phase 4).
6. **SMS → AWS End User Messaging** (with 10DLC).
7. **Chatwoot** widget injection (last).

## Human dependencies (can start in parallel; gate go-live)
- Create the **ADF AWS account**; enable SES + End User Messaging.
- Add **DNS**: DKIM/SPF/DMARC for the sending subdomains.
- Request **SES production access**; set up an **SMS origination number + 10DLC**.
- (Later) provision a **Chatwoot** instance on AWS.

## Stress test
1. **Deliverability (the #1 risk).** *Fix:* front-load the bounce/suppression/unsub spine
   (phase 3 before any bulk send); warm-up; separate subdomains; Brevo fallback.
2. **AWS suspension from a bad first blast.** *Fix:* warm with transactional; cap early
   sends; CloudWatch alarms; never send to an unverified/cold list at full volume.
3. **Builder scope creep (a mini-Mailchimp).** *Fix:* lean on GrapesJS/MJML rather than
   hand-rolling an editor; ship a minimal block set first.
4. **Compliance (CAN-SPAM/GDPR).** *Fix:* unsubscribe + consent records + footer address
   built into the send path, not bolted on.
5. **10DLC delay.** *Fix:* start registration early; keep Brevo SMS as fallback until
   approved.
6. **20i can't host real-time chat.** *Fix:* Chatwoot on AWS, widget-injected — never in
   the plugin.
7. **Maintenance / bus factor.** *Fix:* pluggable drivers, boring tables, Brevo as a
   permanent escape hatch.
8. **AI hallucinating facts (wrong dates/prices/links in a real send).** *Fix:* tool-
   grounded data only; unverifiable values become visible `[TODO: confirm]` placeholders;
   drafts are never auto-sent — a human reviews and sends.
9. **AI output breaking the builder (malformed blocks).** *Fix:* validate Claude's JSON
   against the block schema and auto-repair/reject; the canvas only ever loads valid blocks.

## Non-goals (for now)
- No dedicated IP (shared pool until volume justifies it).
- No multi-account / white-label sending.
- No chat built into the plugin (Chatwoot only).

## Related decision (logged)
- **Ad Manager stays a separate, standalone plugin** (`oc-ad-manager`) used across sites;
  the ads module will be **removed from the festival plugin** in a later release (the
  festival site simply runs both). Tracked separately from this email scope.

## Open decisions before build
- Sending subdomains (`news.` / `mail.`?) and the from-name/from-address per stream.
- Which transactional emails migrate first for warm-up.
- Segment definitions Elayne/Daniel actually want (e.g. "lapsed 2024 buyers").
- Chatwoot hosting size + who administers it.
- Which Claude model for the co-pilot, and the initial brand-knowledge seed (facts +
  a handful of past emails as examples) to load on day one.
