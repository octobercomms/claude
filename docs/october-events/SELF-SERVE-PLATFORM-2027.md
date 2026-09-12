# Self-serve events platform — 2027 scope

Status: scoping. Owner: Daniel. Target: 2027 festival cycle.

## 1. Why

During the festival, October hand-posts around 20 events and fields a stream of
edits by email (the "Ronnie from HKS keeps sending me changes" problem). That is
the admin burden this removes. Organisers post and edit their own events. October
gets out of the loop for the routine work and monetises the parts that are worth
paying for.

Revenue is upside, not the driver. The driver is killing the posting and editing
workload. Build in that order.

## 2. Goals and non-goals

**Goals**
- Organisers self-register, create, publish and edit their own events with no
  October involvement after a one-time approval.
- October is notified on publish and on edits, and can unpublish anything.
- Optional paid add-ons chosen per event at the point of publishing.
- Organisers manage their own registrations and download the list themselves.

**Non-goals (2027)**
- Not a white-label platform. Events live on the ADF board, ADF brand.
- Not a general marketplace. An empty board at launch is fine; supply is seeded
  by migrating existing ADF events.
- No org/team accounts. The user is the organiser (see 3).

## 3. Roles and approval

- **User = organiser.** Approval sits on the WordPress user, not an organisation.
  Handover (someone leaves HKS) is handled by reassigning the login's email. No
  org entity.
- **Approve once, then trust.** New user signs up as `pending`. Their first event
  is held for review. October approves the *user*; that review is the identity
  check (is this really HKS). After approval the user's events publish immediately
  and they edit their own live events freely.
- **October is notified** on each publish and on edits, and can unpublish or
  suspend a user (which pulls their events).
- Trust flag lives in user meta (e.g. `oe_organiser_status`:
  `pending | approved | suspended`).

## 4. Event lifecycle

1. Sign up → `pending`.
2. Create first event → saved as pending/draft. October approves the user.
3. User `approved` → this and all future events publish on submit.
4. User edits their own live events any time. October gets an edit notification.
5. Suspend user → their events unpublish.

Open decision: whether changing **date or price** after publish re-triggers review.
Recommendation: no. Trust the user once approved and rely on the edit notification.

## 5. Registration model (three tiers, chosen per event)

| Tier | How it works | Attendee money | October revenue | Their Stripe? |
|------|--------------|----------------|-----------------|---------------|
| **External** (default, most) | Link out to Eventbrite or their own page | Off-platform | None | No |
| **Managed free** | On-platform registration, $0 / RSVP. Organiser views and downloads the list from their dashboard, any time | None | Flat per-event handling fee | No (fee to October's Stripe) |
| **Managed paid** | Sells tickets in October's checkout, money lands in the organiser's account | Paid to organiser | Application fee per ticket | Yes — Stripe Connect (Express) + KYC |

- **Managed free** removes the day-before list email entirely. The organiser
  self-serves the list from their dashboard, scoped to their own event only. Uses
  the existing attendee export.
- **Managed paid** is the "keep visitors on one page to pay" add-on. Optional,
  minority, later phase. Value is on-page checkout instead of a redirect.
- Connect is only needed for managed paid. Tiers 1 and 2 use October's own Stripe.

## 6. Add-on / upsell model

At the publish step the organiser sees a **priced checklist for this event**:

- We run your registrations and give you the list — $X (managed free handling)
- Include in the newsletter (reaches N subscribers) — $X
- Featured placement — $X
- Social / advertising boost — $X
- Volunteers management — $X
- Sell tickets on-page (needs your Stripe) — application fee

Rules:
- Running total updates as they tick.
- Payment is **to October for services**, so plain Stripe Checkout on October's
  own account. No Connect for add-ons.
- On successful payment the event publishes and a **fulfilment task** is created
  listing exactly what was bought.
- **Free publish stays one click.** The add-on screen shows with nothing ticked
  and a clear "Publish free" beside "Add services and pay." Never gate the free
  path behind it.
- Anchor each price with its value ("reaches 8,000 subscribers"), not a bare
  number.

## 7. Fulfilment queue

Taking money for a newsletter slot creates an obligation. October needs a simple
"paid add-ons to deliver" list (event, buyer, add-ons purchased, status: to do /
done). Without it, work gets missed after payment. This is operational and
required, not optional.

## 8. Architecture: Crocoblock does the surfaces, the plugin does the rules

| Piece | Crocoblock | Plugin |
|-------|-----------|--------|
| Organiser signup + account area | Profile Builder | — |
| Front-end create / **edit own event** | JetFormBuilder (insert/update the existing CPT, author = user) | **Ownership guard on save** |
| Add-on checklist + total + payment | JetFormBuilder (calc + Stripe action, publish on success) | Add-on order record + fulfilment queue |
| Public board + filters | JetEngine listing + JetSmartFilters (exists) | — |
| Approved → auto-publish, else hold | — | **Approval-gated publish rule** |
| Notify October on publish + edit | light JetEngine trigger | notification rule (authoritative) |
| Managed-free registration + self-serve list/CSV | dashboard widget (Profile Builder) | RSVP collection + per-user list scoping (existing ticketing) |
| Managed-paid selling | — | **Stripe Connect (Express, KYC, app fee)** |

The real custom code is small: the approval-gated publish, the ownership guard,
the notifications, the add-on order record + fulfilment queue, the dashboard list
scoping, and (later) Connect. Everything else is Crocoblock config on tools
already owned.

## 9. Security

- **Ownership isolation is the critical line.** JetFormBuilder will let user A edit
  user B's event if the form is trusted alone. Enforce ownership server-side in the
  plugin on every event save and on every registration read/download. A user only
  ever sees and edits their own events and their own event's registrations.
- Approval status checked server-side before publish, not just hidden in the UI.
- Add-on payment verified server-side before the event publishes or the fulfilment
  task is created.

## 10. Phased plan

**Phase 1 — Self-serve posting (the burden killer)**
Organiser signup, first-event approval, front-end create/edit, approval-gated
publish, edit ownership guard, publish/edit notifications, public board, free
listings with external ticket links. Mostly Crocoblock plus three small plugin
rules. This alone removes the festival admin pain.

**Phase 2 — Managed free registration + add-ons**
On-platform RSVP/$0 registration, self-serve list + CSV in the dashboard, flat
handling fee, and the add-on checklist + Stripe Checkout at publish + fulfilment
queue. Reuses the existing ticketing engine. This is where it starts to earn.

**Phase 3 — Managed paid selling + productised add-ons**
Stripe Connect (Express) for on-page paid selling with money to the organiser and
an application fee to October. Newsletter, featured, advertising and volunteers
matured from concierge into repeatable delivery.

Ship 1 and 2 before touching 3.

## 11. Decisions still open

1. **Add-on prices** — the checklist needs real numbers ($ per newsletter slot,
   featured, boost, managed-free handling fee, and the paid-selling application
   fee %).
2. **Managed-free handling fee shape** — flat per-event (recommended, predictable)
   vs per-registration.
3. **Edit after publish** — does changing date/price re-trigger review?
   (Recommendation: no.)

## 12. Risks

- **Fulfilment discipline.** Money taken = work owed. The queue in section 7 is
  the control.
- **Free-path friction.** If the add-on step slows down a free publish, it
  reintroduces the very friction being removed. Keep free one click.
- **Crocoblock at volume.** Heavy relations/meta queries and template upgrades need
  a staging site. Acceptable given Crocoblock is already in use.
- **Ownership leak.** The single most likely security failure in a low-code build.
  Enforce server-side (section 9).
