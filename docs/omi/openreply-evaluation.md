# OpenReply for OMI — evaluation

Decision aid for the question the user actually asked: **"Could OpenReply replace
/ become a DM bot in OMI?"** Short answer: OMI has **no DM bot today**, so this
wouldn't replace anything — it would add a **new Shared → Social capability**
(Instagram comment→DM automation). OpenReply is a good reference for the *domain
model*, but its stack shouldn't be forked into OMI. Below is what it is, how it
maps, what's genuinely hard, and a phased recommendation.

Companion to `opencut-evaluation.md` — same "borrow the idea, not the codebase"
posture.

---

## What OpenReply is

A self-hosted, open-source alternative to ManyChat for one job: **comment-to-DM**.
Someone comments a keyword on an Instagram post → the system auto-sends them a DM.

Features (from its README):
- Keyword matching (whole-word / partial) on comments
- Optional public comment reply alongside the DM
- Tracked links (URL → redirect with click analytics)
- `{username}` personalisation
- Rate limiting to stay under Meta's ~750 private-replies/hour cap
- Multi-account under one workspace
- A DM inbox to read/reply inside the dashboard
- Full send/skip/failure logging

Stack: **Next.js 16 / React 19, PostgreSQL + Prisma, BullMQ on Redis, Auth.js +
Resend, the official Instagram API.**

---

## Does OMI want this?

There's a real gap. OMI's **Shared → Social** section covers publishing and
insights but has nothing for *inbound engagement automation*. Comment→DM is one
of the highest-converting organic-social plays agencies sell, and clients
frequently pay a monthly ManyChat/Manychat-style fee for exactly it. Offering it
inside OMI — tied to the client's existing connected IG account — is a credible
paid add-on and a retention hook.

So: worth adding **as an OMI capability**, if the user has clients who run
IG/organic and want lead capture from comments. Not worth adding speculatively.

---

## How it maps onto OMI

| OpenReply concept | OMI home |
|---|---|
| Instagram account connection | **Already exists.** `connectors/meta.js` has full IG Business OAuth — `instagram_basic`, `instagram_manage_insights`, `instagram_content_publish`, page tokens, `listInstagramAccounts`. |
| Keyword→DM rules | New: a rules table + matcher, per connected account. |
| Tracked links + click analytics | Partial: `dev/ticker-link` is a link tool; the redirect+click-count idea is already in-house to borrow. |
| DM inbox | New UI under Shared → Social. |
| Contacts captured from DMs | **Reuse** the leads/contacts library + `leadScoring`/outreach so a comment→DM lead flows into the CRM the platform already has. |
| Multi-account workspace | OMI is already multi-client; scope rules + tokens per client. |
| Capability gating | **Reuse** the `can_use_visualise` pattern → `can_use_social_dm` (admin toggle). |

**The head start is real:** OMI already owns the hardest plumbing OpenReply had
to build from zero — Meta OAuth, IG Business account resolution, per-client token
storage/refresh, a connectors abstraction, a contacts/CRM, and a capability
system. That materially lowers the build vs starting from OpenReply's skeleton.

---

## What's genuinely new / hard

1. **`instagram_manage_messages` permission + Meta App Review.** Sending DMs and
   private replies needs a scope OMI doesn't currently request, and Meta requires
   **App Review with a screencast demo** for it. This is the real timeline driver
   (days–weeks, and can be rejected). *Start this first — code is cheap next to
   the review gate.*
2. **Webhooks.** Comment→DM needs a Meta webhook subscription for `comments` (and
   `messages` for the inbox), with the verify-token handshake + `X-Hub-Signature`
   validation. OMI has inbound webhook handlers (`sesWebhook`, bounce) to model
   on, but the Meta signature flow is new.
3. **Messaging-window policy.** Meta only allows messaging within a **24h window**
   after user interaction (and private replies within **7 days** of a comment, one
   per comment). The rules engine must encode these or sends fail / risk the app.
4. **Rate limiting.** The ~750/hr private-reply cap needs a throttle/queue. OMI's
   inline queue pattern (edit_jobs / swipeProcessor) can carry this without adding
   Redis.
5. **DM inbox UI + realtime-ish polling.** New surface; medium build.
6. **Per-client token scoping + ToS.** Every route access-controlled per client
   (same as `/api/strategy`); clear opt-in, since automating a client's DMs is
   sensitive.

---

## Build vs adopt

**Do not fork OpenReply.** Its stack (Next.js/Prisma/BullMQ/Redis/Auth.js) is a
different world from OMI (Express + `pg` + inline queues + the existing auth).
Adopting it would mean running a second app and a Redis dependency OMI doesn't
have. **Borrow the domain model** — rules, tracked links, send/skip/fail logging,
the messaging-window guardrails — and reimplement on OMI's rails, reusing the
Meta connector and contacts CRM.

---

## Recommended path (phased, each shippable)

- **Phase 0 — Meta App Review (start now, parallel to everything).** Add
  `instagram_manage_messages` to the requested scopes, record a demo, submit.
  Nothing else ships until this clears, so it gates the timeline, not the code.
- **Phase 1 — Comment→DM MVP.** `comments` webhook → keyword matcher → private
  reply/DM send via the Meta connector, with the 7-day/one-per-comment and rate
  guards. Rules CRUD + send log. One connected IG account per client. Behind
  `can_use_social_dm`. Captured commenters land as leads.
- **Phase 2 — Tracked links + inbox.** Borrow `ticker-link`'s redirect+click
  model for `{link}` tokens; add a read/reply DM inbox (`messages` webhook).
- **Phase 3 — Analytics + polish.** Per-post/per-rule conversion, multi-account,
  `{username}` personalisation, A/B DM copy.

---

## Verdict

**Worth building as an OMI "Shared → Social" capability — not by adopting
OpenReply's codebase, but by borrowing its model onto OMI's existing Meta +
CRM + capability rails.** OMI is unusually well-placed because the expensive
plumbing already exists; the true cost and risk is the **Meta App Review** for
messaging permissions, so that should be kicked off before any build. If the user
doesn't have clients asking for IG comment→DM, shelve it — the app-review effort
isn't worth it on spec.
