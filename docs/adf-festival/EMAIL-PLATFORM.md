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
- **Safety rail:** keep a **pluggable transport** with **Brevo as an instant fallback**
  during transition; never rip Brevo out on day one.

## Why this is worth it (and the honest risk)
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
  Outlook. Embedded in wp-admin (or the platform UI later).
- **Images from the WordPress media library** via the existing media picker (store URLs;
  ensure public serving).
- Save reusable templates; preview; send test; schedule; pick list/segment as audience.

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
   (warm-up begins with engaged transactional).
2. **Native contacts/lists/segments** from existing data — **kills the manual import**.
3. **Deliverability spine** — SNS bounce/complaint ingestion, suppression, one-click
   unsubscribe + List-Unsubscribe. (Gate before any bulk send.)
4. **Campaign builder** (GrapesJS/MJML + WP media) + **bulk sender** (queue/throttle to
   SES rate limits) + **open/click analytics**.
5. **SMS → AWS End User Messaging** (with 10DLC).
6. **Chatwoot** widget injection (last).

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
