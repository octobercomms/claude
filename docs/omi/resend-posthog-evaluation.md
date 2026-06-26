# Vendor evaluation — Resend & PostHog

**Date:** 2026-06-26
**Verdict:** Do not adopt either right now. Both are parked, with explicit
revisit triggers below. This note exists so we don't re-litigate the decision
in three months.

---

## What they are

- **Resend** — developer-first email API. Transactional email (REST/SMTP, React
  Email templates) plus first-party Audiences + Broadcasts (marketing sends with
  open/click tracking), webhooks, batch sending. Free tier 3k emails/mo;
  transactional from $20/mo; marketing tier separate ($40–650/mo by contact
  count). **No SMS.**
- **PostHog** — all-in-one product platform: product + web analytics, session
  replay, feature flags, A/B experiments, surveys, error tracking, data
  warehouse. Generous free tier (1M events, 5k replays, 1M flag requests/mo),
  then usage-based. Self-hostable.

---

## Why not Resend

Our email is deliberately **per-client and client-owned**, not accidentally
fragmented. Each client uses their own Brevo / SES account so they own their
lists, data and GDPR footprint, and (with Brevo) can self-serve campaign
building. A single centralised Resend account is a *downgrade* for anything a
client needs to own.

- **Client email → keep recommending Brevo.** Non-technical clients get a visual
  builder, their own CRM/contacts, and SMS. Resend is developer-first; a client
  won't build campaigns in it.
- **OMI press outreach → SES wins on cost.** SES ≈ **$0.10 / 1,000 emails**;
  Resend transactional ≈ **$0.40–0.90 / 1,000** (4–9× more). The Mautic → SES
  move for OMI press outreach is the correct, cost-controlled call. Resend's only
  advantage over SES is plumbing we can do ourselves (open/click + bounce
  webhooks via SES configuration sets + SNS, templates, a dashboard) — not worth
  ~$20/mo when we're already comfortable with SES.

**Conclusion:** Brevo (client email) + SES (OMI outreach) already cover both
cases better and cheaper. No Resend.

## Why not PostHog (yet)

Two separate analytics jobs, and they must not share a tool:

- **Client-site analytics (Clarity, GA4)** — the client logs in and owns the
  property and data. PostHog can't be cleanly client-owned: its org/billing is
  October's, and it's not a white-label client portal. So PostHog is **wrong for
  any client-facing deliverable.** Keep Clarity/GA4 per client.
- **October-owned app internals** (OMI `platform`, october-mi-shopify,
  october-platform SPA, october-outreach) — *we* own these, so PostHog's
  funnels / replay / flags would be legitimate here. **But** product analytics
  only pays off with a population to find patterns in, and we're not opening
  these apps to external users yet — still refining/using them internally. An
  audience of one is noise.

**Conclusion:** PostHog is a "when we open up" decision, not a now decision.
Pre-scale, only error tracking + session replay have any value, and only if
we're hitting bugs we can't reproduce.

---

## GA4 vs PostHog (the recurring question)

They answer **different** questions — "better" is the wrong frame.

| Question | Best tool |
|---|---|
| Which *channel* drove this conversion? (ads/organic/email/social → sale) | **GA4** — free, client-owned, native Google Ads + multi-touch models |
| What did *this person* do on-site, step by step? (funnels, drop-off, replay) | **PostHog** — person-centric, anonymous-by-default, merges history on identify |
| What is a customer's *whole* journey across online + showroom + email? | **Neither** — that's a single-customer-view / CDP job, keyed on email (Brevo + WooCommerce + offline) |

Notes that keep coming up:
- **PostHog tracks anonymous visitors by default** (doesn't need login); it merges
  the anonymous history into the person when they identify/checkout.
- **"What do social visitors do on-site?"** → PostHog strength (segment by initial
  UTM/referrer cohort).
- **"Where do most sofa sales come from?"** → GA4 + ad platforms are stronger
  (real attribution + ROAS). PostHog can only do a simple first/last-touch
  breakdown, and the purchase event must be instrumented into it from WooCommerce.
- Either tool needs **disciplined UTM tagging** to make "channel" meaningful.

---

## How this lands on our AI Data Analyst

The OMI Data Analyst (`dev/platform/backend/src/routes/chat.js`) is a Claude
tool-using agent over per-client connectors, not a generic chatbot.

- **Already wired:** GA4 is a connector (`get_connector_data`), and Clarity feeds
  `get_cro_findings`. So channel-trend and on-page funnel questions ("where do
  sofa sales come from", "how are the sofa pages doing") are answerable **today**
  for any client — and via tooling the client owns.
- **PostHog would be a new connector, not a "link."** The template already exists:
  `services/clarity.js` (per-client token → pull aggregates from a free API →
  hand summary to Claude). A PostHog connector would mirror it: per-client project
  API key, HogQL/query API for aggregates (funnel drop-off, conversion by
  channel), plus a `get_posthog_*` tool in `chat.js`. ~1–2 days. Feed Claude
  **aggregates, not raw events**, to control PostHog usage and token cost.

---

## Case study that settled it: Another Country

- Online sales ≈ **£120k/year** (small DTC furniture store on WooCommerce).
- A great analytics-driven conversion uplift (~10%) is ~£12k/year *ceiling* — not
  enough to justify a PostHog connector build, the October-owned data wrinkle, and
  an ongoing tool.
- **They're already covered for free:** GA4 (channel trends) + Clarity (funnel
  leaks) both already feed the analyst. At this revenue the lever isn't more
  analytics — it's acting on the Clarity findings we already surface, plus traffic
  and AOV.

---

## Revisit triggers

Reopen this decision only if:

1. **An October-owned app opens to external users / turns on signups** — instrument
   PostHog *just before* that, to get baseline data from the first cohort. (Best
   first candidates: october-mi-shopify, october-platform SPA — currently zero
   analytics.)
2. **A client's online revenue / traffic grows materially** (rough rule of thumb
   ~£500k+ online, or high enough traffic that session-level funnel depth beats
   GA4 + Clarity) — then a per-client PostHog connector may be worth building.
3. **We start hitting unreproducible bugs** in a new SPA — PostHog session replay +
   error tracking become useful even pre-scale.
4. **A genuine single-customer-view / omnichannel (offline + online) project gets
   scoped** — but that's a CDP/warehouse problem keyed on email, with the analytics
   tool secondary; don't mistake PostHog for the solution.

Until one of those fires: **no action.** Brevo + SES for email; GA4 + Clarity
(already in the analyst) for analytics.
