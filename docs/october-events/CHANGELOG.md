# October Events — changelog

The plugin self-updates from GitHub Releases tagged `oe-v<version>`. Bump the
`Version:` header in `october-events.php` (and the `Stable tag` in `readme.txt`)
and merge to `main`; the release workflow builds and publishes the release
automatically.

## 1.82.1 — partner feed: one-click "Save & sync now"

Fixes a usability trap in the **Partner volunteer feed** setup. The old **Sync
now** button was a plain link that acted on the *saved* settings only, so typing
in the URL / username / Application Password and clicking it (instead of the
far-away **Save Changes** button at the bottom of the page) navigated away
without saving — the fields came back blank and the sync reported
`not_configured`.

- The button is now **Save & sync now**, a form submit that saves the feed
  credentials **and then** runs the sync in one action — no save-first /
  sync-second ordering to get wrong.
- Help text updated to say it saves first, then pulls.

## 1.82.0 — cross-site volunteers (part 2): host tour-location sign-ups on a partner site

Completes the "for Atlanta, host tour-location volunteers on the festival site"
flow. A location flagged **Needs volunteers → Partner site** on the tours site is
now pulled onto the festival site and hosted there.

- **Source (tours) site**: exposes partner-flagged locations at
  `GET oe/v1/volunteers/partner-locations` (auth = an admin Application Password).
- **Partner (festival) site**: **Settings → Events → Volunteer locations →
  Partner volunteer feed** — enter the tours site URL + an Application Password
  (username + password). **Sync now** (and a daily auto-sync) pulls those
  locations and creates a **local** volunteer opportunity for each, so sign-ups,
  the roster, and reminders all live on the festival site. Re-syncing keeps
  capacity/title in step; a location dropped from the feed has its local sign-ups
  closed (kept, not deleted). Materialised opportunities are keyed by
  `site#remote-id` so syncs are idempotent.
- **`[oe_location_volunteers]`** shortcode: a grid of all location-linked
  opportunities (local or pulled) with spots-left — drop it on the festival page
  that hosts sign-ups.
- Server-to-server over `wp_remote_get` (no CORS/browser involved); reuses the
  `manage_options` capability the platform already uses.

## 1.81.1 — fix: location Volunteers box not appearing

The per-location Volunteers box (1.81.0) didn't show even with the Locations post
type set. The meta-box hooks were only attached when the location post type already
existed at `plugins_loaded` — but external (JetEngine) CPTs register later on
`init`, so the check failed and the hooks were skipped. Now the hooks always
attach and resolve the configured post type at admin-load/save time.

## 1.81.0 — one-click volunteers on tour locations (part 1: local hosting)

Volunteer opportunities can now be created from tour **locations** with one click,
the same idea as events — no more building them by hand.

- **Settings → Volunteer locations**: choose the post type that holds your tour
  locations (an external JetEngine CPT). Once set, locations get a Volunteers box.
- **Per-location "Volunteers" box**: tick **Needs volunteers**, set how many are
  needed, and choose where sign-ups are hosted — **This site** or a **Partner
  site**. On save with "This site", a linked volunteer opportunity is created
  (published, one open shift with that capacity) and kept in sync; unticking closes
  its sign-ups (kept, not deleted). You refine shifts/dates on the opportunity as
  normal, and it shows up in Volunteers with the location as its location.
- The **Partner site** option is stored/flagged now; the cross-site piece (exposing
  those locations so a festival site can pull and host the sign-ups) lands next.
- New: `Volunteers::create_or_sync_for_location()`, `for_location()`,
  `linked_location()`, `close_for_location()`, `location_post_type()`; new
  `_oe_linked_location` opportunity meta and a `location_post_type` setting.

## 1.80.0 — interactive YoY chart (toggle years, hover, rescale) + gross-profit KPI

The year-over-year chart is now interactive, and the KPIs show profit after fees.

- **Toggle years on/off**: click any year in the legend to hide/show it. The
  y-axis **rescales to the visible lines**, so hiding the big historical years lets
  you actually compare this year against a similar one.
- **Hover a line** to see which year it is and the cumulative value at that point.
- **Tickets ⇄ Revenue** toggle retained; both now drawn by a small self-contained
  chart script (no external libraries) rather than pre-rendered.
- **New "Gross profit (after fees)" KPI** next to Revenue — revenue minus card
  fees. The fee is configurable under **Settings → Checkout** (*Card fee %* + fixed
  per transaction), defaulting to Stripe's 2.9% + 0.30. Fees are applied per
  distinct paid transaction.

## 1.79.0 — sales-analytics chart: Tickets ⇄ Revenue toggle

The year-over-year cumulative chart now has a **Tickets / Revenue** toggle. Tickets
stays the default; flip to Revenue to see cumulative revenue by weeks-before-event
across all years (live + imported history), with the y-axis in the account
currency (abbreviated, e.g. `$50.9k`). Client-side toggle — both series render
inline, no page reload, still no external chart libraries.

## 1.78.0 — year-over-year overlay on the sales-analytics chart

The Sales analytics cumulative chart can now plot **prior years alongside the live
current year**, aligned by weeks-before-event — so you can see at a glance whether
this year is pacing ahead of or behind previous years (like the "Revenue YoY by
weeks" view teams keep in spreadsheets).

- **Import prior-year weekly history** (Sales analytics → *Prior-year data*): paste
  CSV rows `year, weeks_before, quantity, revenue` (a header row is fine). Stored
  per event; re-importing replaces it, an empty box clears it.
- The cumulative-sold chart draws one line per imported year plus the live year
  (highlighted), with a legend. Still self-contained inline SVG — no libraries.
- Works even before this year has sales, so you can pre-load history and watch the
  live line build against it.

## 1.77.0 — event dates on orders, order details, and weekly sales analytics

Tools for tracking ticket sales week-by-week as an event approaches.

- **Event date column** on the Registrations/Orders table, so every order shows
  which event date it's for (not just the event name).
- **Order details**: each order row now has a **Details** toggle that expands to
  show the buyer, when it was placed, the payment method + reference, any
  discount, and every ticket in the order (number, attendee, status) — one extra
  query for the whole page, no per-row overhead.
- **New "Sales analytics" tab** (Tickets → Sales analytics): pick an event, set
  its date, and see sales counted **backwards from that date** — week 0 is the
  event week, −1 the week before, and so on. Shows a cumulative-sold curve
  approaching the event, a tickets-per-week bar chart, KPI cards (total sold,
  revenue, best week, days to event), and a full weekly breakdown table with
  running cumulative tickets + revenue. Event-only (driven by each event's date);
  charts are self-contained inline SVG/CSS (no external libraries).
- You can **set/override an event's date right on the analytics screen** (writes
  the plugin's `start_datetime`), so the "weeks before" maths always has an anchor
  even for events whose date lives elsewhere.
- New helpers: `Orders::tickets_for_orders()` (batch) and
  `Orders::event_weekly_sales()`.

## 1.76.0 — membership upsell card (benefits + read-more button)

The voluntary "add a Friend membership" opt-in on a normal checkout is no longer a
bare checkbox — it's now a proper upsell card: a bordered, grey-backgrounded panel
with the plan name + price, a few key benefit bullets, an "Add to my order"
checkbox, and a **Read benefits & terms** button linking your membership page.

- **Settings → Checkout → Membership → Membership benefits**: a new field — one
  perk per line (lifted from your membership page) — rendered as the card's
  bullets. Leave blank for no bullets.
- The card uses the existing join label, join amount (for the price), and info-page
  URL. The member-rate summary note is unchanged.

## 1.75.3 — tighter ticket-description line spacing

Added `line-height: 1` to `.oct-ticket-row__desc` so a wrapping two-line
description sits tight under the ticket name instead of looking double-spaced.

## 1.75.2 — checkout mobile restyle + bigger ticket descriptions

- **Mobile layout**: on phones the ticket row now puts the name + description on
  their own line with the price and quantity stepper sharing the line below
  (price left, stepper right) — far more compact than the old stacked layout, so
  more tickets fit on screen. The oversized desktop price is scaled down on small
  screens so large amounts don't overflow, and the promo / details / summary rows
  reflow cleanly. Breakpoint widened to 560px.
- **Ticket description**: shown larger and in solid black (1.5em) so it reads as
  part of the ticket, not fine print.

## 1.75.1 — member rates are freely selectable (no lock, no click-through message)

Member-only rates are now always selectable by anyone — the greyed-out lock and
the "That's a members-only rate" message on click are gone. Selecting one adds it
straight to the cart; the order then reacts to the buyer's email (member → member
price; non-member → membership auto-added). Note: for the non-member auto-join to
charge, a **Join price ID** must be set (Settings → Checkout → Membership).

## 1.75.0 — membership on every checkout: auto-join for member rates, free-ticket join, T&Cs link

Refines the join-at-checkout UX (from 1.74.0) into the full "offer membership on
any ticket" flow.

- **Member rates are no longer locked** — anyone can select one. The order then
  reacts to the buyer's email: an active member simply pays the member price; a
  non-member automatically has the **Friend membership ($5/mo) added** to the
  order so they qualify. No checkbox to hunt for.
- **Free ticket + membership**: a free RSVP can become a **$5 checkout** — tick
  "Add a Friend membership" and the membership's first month is the only charge.
  Handled by a new membership-only Stripe path (`/membership-intent` +
  `/membership-confirm`): the subscription's first invoice is confirmed with the
  card, then the free ticket is issued.
- **Voluntary opt-in on any checkout**: on a normal (non-member-rate) ticket,
  non-members see an "Add a Friend membership — $5/mo" checkbox.
- **Order Summary now sits below Your Details**, so the membership appears right
  after the buyer enters their email and it's checked against Stripe.
- **Membership info link**: wherever a membership is added, the summary shows
  "Read about Membership Benefits and Terms" linking to your membership page (new
  Settings → Checkout → Membership → *Membership info page*).

## 1.74.0 — one-click join: subscribe + buy the member rate with the same card (part 3)

A non-member can now join the membership **and** buy the member-rate ticket in a
single checkout — no leaving the page, one card entry, one click.

- **Settings → Checkout → Membership → Join offer**: paste the recurring **join
  price ID** (e.g. Friend monthly, `price_…`) and an optional **display amount**
  (in cents). With a price set, the member-rate offer becomes a one-click join;
  with no price set, it falls back to the external Payment-Link button as before.
- **Checkout**: when a non-member picks a member rate, the offer shows a "Join as
  a Friend — $5/mo" **checkbox**. Ticking it unlocks the rate, adds the first
  month to the summary (shown separately — Stripe bills it apart from the ticket),
  and lets them pay once. Behind the scenes the ticket is charged at the member
  rate and the card is saved; the membership subscription is then created and
  billed off-session against that same card. The success screen confirms the new
  membership.
- **Server-side**: the ticket PaymentIntent is tied to a Stripe customer with
  `setup_future_usage` so the card is on file; on confirm we create the
  subscription (idempotent — it won't double-subscribe on a retry), then bust the
  member cache. PayPal is hidden while joining (the subscription needs the card),
  and the member rate still can't be taken by a non-member who isn't joining.

Heads-up: this path moves real money on your **live** Stripe keys. Do one real
join to verify end-to-end (member rate charged + a live subscription created),
then refund/cancel that test.

## 1.73.0 — ticket-type editor: drag to reorder + per-type description

Two refinements to the ticket-type editor:

- **Drag to reorder**: each ticket-type row now has a drag handle (⣿) — grab it to
  reorder the types. The order you set is the order buyers see at checkout.
- **Description field**: a per-type description input (under the label). Whatever
  you type shows under the ticket name on the checkout row, so it's always visible
  — useful for spelling out what a rate covers (e.g. the member rate, a group
  bundle, or a Serenbe-only ticket). The checkout already rendered descriptions;
  there just wasn't a place to enter one.

## 1.72.0 — members-only ticket rates + join-at-checkout offer (part 2)

Ticket types can now be flagged **Members only**, so a special member rate is
reserved for people with an active membership — and everyone else is invited to
join right at checkout.

- **Ticket type editor**: a new **Members** checkbox on each ticket type. Tick it
  to make that rate members-only (e.g. a discounted member price).
- **Checkout**: a members-only rate shows a "Members only" badge and stays locked
  until the buyer's email is confirmed as an active member. As soon as they enter
  a member email under *Your Details*, the rate unlocks automatically. A
  non-member who tries to pick it sees a **join offer** with a button to your
  membership plan.
- **Settings → Checkout → Membership**: new **join link** (paste your Stripe
  Payment Link — e.g. the Friend monthly plan) and **join button label** for that
  offer. Leave the link blank to simply keep member rates locked to non-members.
- **Enforced server-side**: pricing/checkout re-checks membership for any
  members-only line, so the rate can't be grabbed by editing the page — you must
  buy with the email on an active membership. A new public, rate-limited
  `/member-check` endpoint powers the live unlock (returns only yes/no).

Still to come (next stages): subscribe-with-the-same-card during checkout, and
the follow-up email nudging non-members to join a few days after purchase.

## 1.71.1 — membership detection: match by product ID too

Member detection now matches a subscription if **either** its price ID **or** its
**product ID** is in the configured list. So you can paste a product ID (`prod_…`)
and it counts everyone subscribed to that product — both its monthly and yearly
prices — rather than needing every individual price ID. (Fixes member checks
returning "not a member" when a product ID was pasted instead of a price ID.)

## 1.71.0 — membership foundation: detect Stripe members (part 1 of the checkout upsell)

First stage of the ticket-checkout membership feature. This part is the
foundation — detecting who's a member — with nothing wired into checkout yet, so
it's safe to install and configure ahead of the rest.

- **Settings → Checkout → Membership**: enable the feature and paste your
  membership **Stripe price IDs** (Friend/Patron, monthly + yearly). Anyone with a
  live Stripe subscription on one of those prices counts as an active member.
- **`StripeConnector::member_status($email)`** looks a member up by email (customer
  → active subscription on a configured price), cached briefly.
- **"Is this email a member?" test** in Settings, so you can confirm your price IDs
  resolve before member rates go into checkout.

Still to come (next stages): member ticket rates + the "join at checkout" offer,
subscribe-with-the-same-card, and the follow-up email for non-members.

## 1.70.6 — dashboard revenue reflects total Stripe income for the year

The Revenue KPI (platform dashboard + wp-admin) read only tickets sold *through
this plugin*, so it showed $0 whenever sales run through Stripe another way. It now
shows the **total Stripe volume for the calendar year** — every succeeded charge on
the account, in the account's currency — via a new `StripeConnector::year_revenue()`
(paged from the charges API, cached for an hour). Falls back to the plugin's own
ticket revenue if Stripe isn't configured. The platform's Revenue card notes
"Stripe · YYYY to date" when the figure comes from Stripe.

## 1.70.5 — refund / cancellation emails now use the branded template

The refund, cancellation, rejection and waitlist emails were going out through a
plain generic wrapper (thin grey rounded border, brand *name* only, no logo) that
didn't match the branded ticket confirmation. Their shared shell (`wrap()`) now
uses the **same house style as the ticket email** — the brand **logo**, the 2px
black border card, and the matching header/footer ("Questions? Just reply…"). The
message text is unchanged; only the styling is now consistent.

## 1.70.4 — newsletter digest hard-disabled (early-concept, not ready)

The subscriber newsletter is still an early concept — the content, design and
subject aren't finalised — so it's now **fully switched off in code** until it's
ready, not just defaulted off.

- A master switch (`Cron::DIGEST_ENABLED = false`) makes `run_digest()` a **no-op**:
  it cannot send, automatically or manually, whatever the settings say or who
  triggers it.
- In Settings → Email & SMS, the newsletter is shown as **"Coming soon — switched
  off"** (no toggle), and the manual **"Send digest now"** button is hidden.
- The **daily ticket sales report** (internal, to one address) is unaffected and
  stays — now in its own clearly-labelled card, separate from the newsletter.

Flip `DIGEST_ENABLED` to `true` to bring the newsletter back (opt-in + the
once-per-month lock from 1.70.3 still apply).

## 1.70.3 — monthly digest: opt-in + a hard once-per-month lock

Fixes a serious bug: the monthly digest was **on by default** and had **no guard
against sending twice**, so a double-firing first-Monday cron tick could blast the
entire subscriber list more than once.

- **Once-per-month lock.** `run_digest()` now claims an atomic per-month marker
  (`add_option`, a unique INSERT) before sending. A second trigger in the same
  calendar month — a duplicate cron tick, an accidental second "Send digest now",
  or a manual + auto overlap — is **refused**. It can never double-send again.
- **Opt-in.** The automatic monthly digest now defaults to **off**. It only fires
  when you tick "Send the monthly digest automatically" in Settings → Digest &
  reports. (Sites that had it on keep it on — untick it to stop.)
- **Clearer + guarded UI.** The auto toggle and the manual "Send digest now"
  button both spell out that it emails *every subscribed contact*; the manual
  button now asks for confirmation and reports "already sent this month" instead
  of silently re-queuing.

Note: to stop a send already in progress, deleting the campaign in the platform
removes its queued messages and halts it.

## 1.70.2 — reveal a saved secret (to copy a key between sites)

The "show" (eye) button on a saved API key / token did nothing, because saved
secrets are never sent to the browser on page load (a deliberate hardening). It
now **fetches the saved value on demand** when you click the eye — so you can read
and copy a key (e.g. the GitHub updater token) to paste on another site.

- Admin-only (`manage_options`) and nonce-protected; the value is fetched with a
  single authenticated request only when you click show, never echoed into the
  page otherwise.
- Works for the Stripe / Claude / Maps / PayPal keys, the SES & AWS secrets, and
  the GitHub token. Values pinned by a `wp-config.php` constant are never revealed
  (their fields stay locked, as before).

## 1.70.1 — "Valid at" is a compact dropdown, not a wall of checkboxes

With a lot of doors, a checkbox-per-door in every ticket row got unwieldy. Each
ticket type's "Valid at" is now a small **dropdown** that shows **"All doors"** or
**"N selected"**, and only opens the (scrollable) door checklist when you click it —
so a row stays one line no matter how many doors you have. Same data underneath;
tick none = valid at every door.

## 1.70.0 — bring the staff platform back (Tasks + Volunteers), readiness stays gone

1.69.0 removed the whole staff platform along with the event-readiness board. The
platform itself is wanted — this restores it, minus the readiness piece.

- **`dev/october-platform` is back** with its **Tasks** and **Volunteers** boards,
  the dashboard, email, contacts and the AI assistant — and its backing `oe/v1`
  Tasks/Volunteers API, CORS, and the platform settings (allowed origins +
  platform URL) and the wp-admin "Open the platform" button.
- **The event-readiness "Planning" tab stays removed.** The SPA no longer has an
  Events/readiness board or any `/planning` calls; its dashboard shows **Events
  live** (published) from `/stats` instead of a confirm/green count. Events are
  still managed in WordPress / JetEngine with no go-live gating.

(Net effect vs 1.68.1: only the readiness board + gating are gone; everything
else — including the platform — is retained.)

## 1.69.0 — remove the event-readiness board + the staff SPA

The "confirm → green" event-readiness workflow was more friction than help —
events were being blocked from going live over fields that didn't matter. It's
gone, along with the separate staff platform that fronted it.

**Removed:**
- The **readiness / gating engine** (`Gating`) and the confirm-to-publish flow.
  Events now publish through WordPress / JetEngine as normal — no go-live gate.
- The plugin's **planning board** (the old "Events" admin screen); the **Events**
  menu now opens the native WordPress events list.
- The **`dev/october-platform` staff SPA** entirely (Planning, Tasks and
  Volunteers tabs) and its backing management API (`/planning`, `/tasks`,
  `/volunteers` under `oe/v1`), plus the now-unused **Tasks** module and the
  cross-origin (CORS) / platform-origin settings that existed only for the SPA.
- The **Event readiness** settings section, the readiness dashboard tile, and the
  AI assistant's "event readiness" question.

**Kept, unchanged:** ticket sales + check-in, promo codes, the public volunteer
signup + reminders, email/AI Stories, reports, and the event **fields**
(name/date/price/**location**…) that the ticket email, calendar files and reports
read — now via a slim data layer with the JetEngine field-mapping still available
under Settings → Events.

## 1.68.1 — check-in doors are now tag chips, not a textarea

The *Check-in venues / doors* field is now a tag input: type a door name and press
Enter (or comma) to lock it in as a chip with an ✕ to remove — instead of a
free-form textarea. Cleaner to scan, and each door is a discrete, deduped entry
that feeds the per-ticket "Valid at" checkboxes. Pasting a newline/comma list adds
them all at once; Backspace on the empty input removes the last chip. Saved doors
are stored exactly as before, so nothing needs re-entering.

## 1.68.0 — "Valid at" is now a door picker + the check-in PIN is always visible

Two fixes to the ticketing UX from real use on the live sites.

**"Valid at" is a checklist, not a free-text box.** You no longer type door names
(and risk a typo silently un-restricting a ticket). Add your doors in *Check-in
venues* and Save, then each ticket type shows a **checkbox per door** — tick the
ones it's valid at (tick none = every door). Selections come straight from your
saved door list, so they always match exactly. Existing restrictions carry over.

**The check-in PIN is generated on open and shown, not lazily.** Previously the
PIN was only created when someone *submitted* one at the scanner — a catch-22,
since staff couldn't submit a PIN they'd never been shown. Now opening an event's
*Tickets & check-in* box generates a secure PIN (if you haven't set your own) and
displays it, so you can hand it to door staff straight away. You can still type
your own 4–6 digits.

## 1.67.1 — venue-restricted tickets: don't auto-advertise the doors

Refines 1.67.0. The venue restriction no longer prints an automatic
"Valid at <doors> only" line on the checkout row, confirmation email, or printed
ticket. That text was redundant with the ticket type's own name and leaked the raw
door names — and the restriction is meant to be usable for reasons other than a
public "Serenbe only" note.

- **Buyer-facing wording is now yours to control** via the ticket type's **label**
  (e.g. "Serenbe Homes only") and its **description** — nothing is auto-generated.
- **The scanner enforcement is unchanged:** a restricted ticket still only checks in
  at its listed doors (online and offline), showing the staff-facing amber "Not
  valid at this door" with the ticket type name.

## 1.67.0 — bigger group orders + venue-restricted ("Serenbe-only") tickets

Two ticketing additions in the event's *Tickets & check-in* box.

**Per-ticket purchase limit (was hard-capped at 10).** Bulk buyers — e.g. a
college buying a block of student tickets — were blocked at 10.

- Each ticket type now has a **"Max/order"** setting, defaulting to **99** (no
  practical limit). Lower it on any type you want to restrict (e.g. a scarce VIP
  ticket capped at 2).
- The buyer's `+` stepper, the server-side pricing, and the order-creation guard
  all honour the per-type cap — a crafted request can't exceed it, and the buyer
  gets a plain-English message naming the limit if they try.

**Venue-restricted ticket types.** When two tours are combined into one event, you
can now sell a cheaper ticket that's only valid at *some* of the doors — e.g. a
"Serenbe (Sunday)" ticket that scans only at the Serenbe homes.

- Each ticket type has a **"Valid at"** field: list the door names it's valid at
  (from *Check-in venues*), or leave it blank for every door (the default and how
  every existing type behaves). Door names are matched to your real venue list, so
  a typo safely falls back to "all doors" rather than blocking entry.
- At the door, scanning a restricted ticket at the wrong home shows a distinct
  amber **"Not valid at this door"** — separate from *invalid* / *already scanned*,
  and no check-in is recorded. Works **offline** too (the scanner's cached manifest
  carries each ticket's allowed doors).
- Buyers see the restriction up front: a **"Valid at … only"** line on the ticket
  type in checkout, carried through to the confirmation email and the printed
  ticket, so nobody buys it thinking it's the full tour.

## 1.66.17 — scale: indexes, fewer queries, tighter throttling

The "make it fast under load" half of the audit.

- **Database indexes** added for the hot ticketing queries — sold-count and
  availability (`orders(event_id,status)`, `tickets(order_id,status)` /
  `(event_id,status)`), the check-in log and door-scan dedupe
  (`checkins(event_id,venue_name,ticket_id)`, `(ticket_id,venue_name)`). They're
  applied automatically on update (DB version bump → `dbDelta`).
- **Fewer queries on every checkout render.** The event-wide "sold" count and
  capacity are now computed once per request instead of once per ticket type
  (a 5-type event was running the same count 5×). The capacity check at purchase
  still reads fresh inside the lock, so it can't go stale.
- **Throttling** added to the remaining public read endpoints (`checkin-events`,
  `volunteer-shifts`, `map`, and the logged-in `confirm-payment`), and the
  Failed-payments "Refresh" now verifies its nonce.

## 1.66.16 — concurrency: stop overselling / double-issue under load

A security + scale audit (see `docs/october-events/security-audit.md`) found the
ticketing path had no concurrency protection — fine day-to-day, a problem when a
big on-sale sends hundreds of buyers at once. Fixed:

- **No more overselling.** The capacity check + ticket issue is now serialized
  per event with a MySQL advisory lock, so concurrent buyers can't all read
  "under capacity" and blow past the limit.
- **No more double-issued tickets.** Order creation is serialized per payment, so
  a Stripe webhook and the browser confirmation can't both create a set of
  tickets for the same payment.
- **Promo codes respect their limit under load** — a use is only recorded while
  the code is under `max_uses` (atomic), so a capped code can't be over-redeemed
  by simultaneous checkouts.
- Ticket inserts are now checked and retry on the (vanishingly rare) token
  clash, instead of silently skipping.

The locks **fail open** — if one can't be acquired they proceed rather than ever
block a sale. (Requires the site's database to be standard MySQL/MariaDB.)

## 1.66.15 — manual registration: clearer event picker

The "Add a registration manually" event dropdown used to silently hide any event
without ticket types, so it could look empty even with live events — with no
explanation.

- The dropdown now lists **all published events**; ones without ticket types are
  labelled **"— no ticket types"**.
- Pick one of those and you get a plain-English hint (with a link to open the
  event and add a type), and the "Issue tickets" button is disabled until the
  event actually has a ticket type.
- A notice appears when you have no events, or events but none with ticket types,
  pointing you to the fix. Events are sorted by name.

(Tickets still need a ticket type to be issued against — this just makes *why*
obvious instead of showing an empty list.)

## 1.66.14 — transaction-wide refunds + a Transactions tab

A cart with several ticket types pays once but is stored as one order per type,
so the per-order refund only covered one type. Refunds now work across the whole
**transaction** (everything under one payment).

- The **Refund…** panel on Registrations now lists **every active ticket in the
  transaction** (all ticket types bought together). All ticked = full refund of
  the whole purchase; untick for partial. One Stripe refund covers it.
- New **Transactions** tab: paid orders grouped by payment — one row per
  purchase, with the buyer, event, ticket count (active / total), amount and a
  status (Paid / Part refunded / Refunded), each with the same refund panel.
- Refund amounts are the selected tickets' proportional share of the
  transaction total; fully-refunded orders flip to "refunded"; the buyer is
  emailed once and freed seats go to the waitlist.

## 1.66.13 — capacity is now event-wide, not per ticket type

Capacity has moved off individual ticket types onto the event. An event now has
one **Event capacity** (total tickets across all types); when it's reached,
every ticket type shows "Sold out".

- The per-ticket-type **Capacity** column is gone; there's a single **Event
  capacity** field under the ticket types (blank or 0 = unlimited).
- Availability, the sold-out state and the checkout capacity guard all count
  admissions across the whole event now.
- Existing events: their old per-type caps are **summed and pre-filled** into the
  new Event capacity field (and used as a fallback until you re-save), so a
  current limit carries over rather than silently becoming unlimited. Set the
  number you actually want and save.

## 1.66.12 — Registrations: partial (per-ticket) refunds

The per-order **Refund** action on Registrations is now a panel where you pick
**which tickets** to refund — all of them (full) or just some (partial) — and a
reason.

- Tick the tickets to refund (all ticked by default = full refund; untick to
  refund only some), choose a Stripe reason (requested by customer / duplicate /
  fraudulent), and refund.
- A partial refund charges back the selected tickets' proportional share of the
  order, voids just those tickets, and leaves the rest valid; the order flips to
  "refunded" only once nothing active remains. The buyer is emailed (the email
  now says how many tickets were refunded for partials), and freed seats are
  offered to the waitlist.
- PayPal orders keep the existing full-refund button (partial card refunds are
  Stripe-only).

## 1.66.11 — Tickets: Failed payments tab

A new **Failed payments** tab on the Tickets screen, pulling declined/failed
charges live from Stripe (last 90 days) so you can see what's turning buyers
away and act on patterns.

- A **pie chart** breaking down failures by reason (insufficient funds, bank
  declines, expired card, wrong CVC, etc.), with counts and percentages.
- A **table** of each failed charge — when, email, card, amount and the
  plain-English reason (plus Stripe's own message).
- Cached for a few minutes with a Refresh button; shows a "connect Stripe"
  prompt if no key is set, and a clean "no failures" state when there are none.

## 1.66.10 — fix: stop browsers autofilling the login password over API keys

The Settings → API keys fields are masked (password-type), so browser password
managers were autofilling the WordPress **login password** into them — and on
save that overwrote the real key (e.g. the Stripe secret key), breaking payments
with "Invalid API Key provided".

- The key fields now tell the browser not to autofill credentials
  (`autocomplete="new-password"` plus 1Password/LastPass/Bitwarden ignore hints),
  and stay read-only until you click into them, which defeats Chrome's on-load
  autofill. They still mask and have the show/hide toggle.
- Belt and braces: on save, a value that doesn't match the key's known prefix
  (Stripe `sk_`/`rk_`, publishable `pk_`, webhook `whsec_`, Claude `sk-ant-`) is
  **rejected and the existing key kept**, with a clear notice — so a stray
  autofill can never silently replace a working key again.

## 1.66.9 — fix: card payments broken when the Stripe PHP SDK is installed

Card checkout failed with *"Unrecognized request URL (POST: /payment_intents)"*
(surfaced as `payment_init_failed`) whenever the Stripe PHP SDK was present on
the site. The connector's SDK path called the low-level client with a
version-relative path (`/payment_intents`) but that client needs the **full**
path including the API version (`/v1/payment_intents`). It now prepends `/v1`,
so every Stripe call (payment intents, refunds, etc.) works on both the SDK and
the raw-REST paths. Not card-specific — it affected all cards, not just Amex.

## 1.66.8 — checkout: plain-English payment errors

Card-payment errors now tell the customer what to actually do, instead of
showing a raw code like `payment_init_failed`.

- **Bank declines** are translated from Stripe's decline codes into plain
  English — e.g. insufficient funds, expired card, wrong CVC, or the common
  "your bank declined this (call the number on the back of your card to approve
  it, or use a different card)". Most declines are the bank's fraud/security
  block, not us, so the copy points customers there.
- **Payment-init failures** now surface the real Stripe reason when it's a card
  or validation problem the customer can fix; otherwise a friendly fallback
  (the full reason is still logged server-side for us). The raw error code is no
  longer shown.
- The same friendlier handling covers the free-registration and PayPal paths.

## 1.66.7 — check-in: offline rescans are door-aware

Online, a scan at a **new door** is always a fresh valid check-in; only a repeat
at the **same door** is flagged "already". Offline (when the venue Wi-Fi drops),
the cached check was door-agnostic, so a ticket already scanned at one door would
wrongly show "already" at a different door. The offline manifest now pairs each
scanned token with its door, so offline matches online — a new door reads valid,
a same-door repeat reads "already". (Stale caches from before this update still
work; they just fall back to the old any-door behaviour until the next refresh.)

## 1.66.6 — checkout: clearer sold-out styling

- The **"Sold out"** label is now full red and the **same size as the ticket
  name**, instead of small faded italics — sold-out rows stay full-strength
  rather than dimmed like other unavailable states, so they read clearly.
- The **Join Waitlist** button now matches the **Apply** button (solid dark
  pill with the accent hover) instead of the small outline style.

## 1.66.5 — waitlist auto-offer on capacity increase + delete orders

- **Raising capacity now offers seats to the waitlist automatically.** Before,
  the waitlist was only worked when an order was cancelled/refunded — bumping a
  sold-out ticket type's capacity left everyone sitting at "pending". Now, when
  you save an event and a sold-out type has open seats again, everyone waiting
  for that type is emailed a checkout link (first come, first served; each
  person is only offered once).
- **Delete orders.** Registrations now has a **Delete** action that permanently
  removes an order, its tickets and any check-in scans — for clearing out test
  data. It's distinct from Cancel (which voids + refunds and emails the buyer);
  Delete leaves no trace and sends nothing. No refund is issued, so Cancel a
  real paid order first if money changed hands.

## 1.66.4 — ticket email "add to calendar" + a Checkout settings tab

- **"Add to calendar" is now a real link.** The ticket email's calendar line
  was static underlined text that only looked clickable, and it always claimed
  ".ics attached" even when none was. It's now a clickable **Google Calendar**
  link, and the ".ics attached" note only shows when an invite is actually
  attached. (The missing attachment itself is fixed in 1.66.2 — events whose
  start was stored as a Unix epoch couldn't produce an .ics.)
- **Checkout settings are easy to find.** The "Terms & Conditions URL" setting
  (plus the pre-event reminder and PayPal) lived under *Keys & platform →
  Planning platform*, where nobody would look. They now have their own
  **Checkout** tab in Settings. Setting the Terms URL still adds the required
  "I agree to the Terms & Conditions" checkbox to the checkout.

## 1.66.3 — check-in log: collapse rescans + add visuals

The Check-in log now reads as one line per ticket per door, with charts above it.

- **Rescans no longer spam the log.** Scanning the same ticket again at the
  **same door** used to add a whole new row; it now collapses into one row with
  a **Rescans** count (e.g. ×2) and a "last scanned" time. A scan at a
  **different door** is still its own row.
- **Three visuals** above the table:
  - **Scans by door** — each event split out by door (a single-door event just
    shows the event name).
  - **Time of day** — a 24-hour chart of when scans happened (in local time).
  - **Most popular door** — the busiest stop per event, to spot the most
    popular home on the tour at a glance.

## 1.66.2 — fix: ticket numbering, email subject + event date

Three ticket-email fixes:

- **Two tickets bought together both showed "01".** A multi-ticket purchase
  splits into one order per ticket type, and each order numbered its tickets
  from 1 — so both tickets read "1 of 1". Tickets are now numbered across the
  **whole purchase**: buy two and they read "1 of 2" and "2 of 2".
- **Vague email subject.** "Your tickets" is now
  **`Ticket: <event> <date> <n/total>`** (e.g. *Ticket: Home Tour March 14,
  2026 1/2*), so the inbox shows exactly which ticket it is.
- **Event date showed as a raw timestamp.** Events whose start is stored as a
  Unix epoch (e.g. `1773446400`) rendered the number verbatim in the email
  because the date parser couldn't read a bare epoch. It now parses epoch
  values, so the formatted date appears in both the email body and subject.

## 1.66.1 — fix: door scanner not detecting + black-band camera

Two check-in scanner bugs:

- **QR codes weren't being detected.** The scanner only looked at a fixed centred
  `qrbox` region, which misaligned with the `object-fit: cover` video — a QR
  aimed at the on-screen frame could fall outside the actual scan region. It now
  scans the **whole camera frame**, so a code is read wherever it's pointed.
- **Half the camera was black.** html5-qrcode's inline video sizing left a black
  band below the feed. The video now **absolutely fills** the reader
  (`object-fit: cover !important`), so it's edge-to-edge.

## 1.66.0 — performance: collapse the volunteer N+1 (P3)

The volunteer read models and the admin Volunteers screen ran a `COUNT(*)` (and
more) **per shift** — an opportunity with 5 shifts was ~17 queries, and the admin
list multiplied that across every opportunity. Now each opportunity loads its
signups in **one query** and tallies filled / pending / spots-left per shift in
PHP. `opportunity_summary`/`opportunity_detail` and `admin/views/volunteers.php`
go from O×(1+shifts) queries to ~1 per opportunity.

## 1.65.0 — security: hardening bundle (S6)

Small, safe hardening from the audit:

- **Rate-limit `/ticket-confirm` and `/paypal-capture`** (30/IP/min) so an
  attacker can't amplify calls into Stripe/PayPal.
- **Validate AI Stories feed URLs** with `wp_http_validate_url()` before
  fetching, blocking SSRF to localhost / link-local / private ranges (cloud
  metadata) even from an admin-supplied URL.
- **Validate the WP-CLI migration `--prefix`** (letters/numbers/underscore only)
  before it's used in table names.

(Deferred, noted in the audit: the promo `max_uses` atomic-decrement and
`UNIQUE` constraints on `payment_id`/`token` — both need a small flow/DB-version
change and are Low severity.)

## 1.64.0 — security: management APIs require admin + AI throttle (S3/S4)

- **Staff/management REST APIs now require an administrative capability.** The
  contact CRM, campaigns (incl. send), tasks, volunteers, reports and the staff
  AI assistant were gated at `edit_posts` — which Contributors/Authors hold. They
  now require `manage_options` via a shared, **filterable** check
  (`OE\Access::can_manage()`); grant a non-admin staff role access with
  `add_filter('oe_manage_cap', fn() => 'oe_manage')`.
- **AI endpoints throttled.** The staff assistant (`/assistant`) and the email
  co-pilot (`/campaigns/copilot`) — each a paid Claude tool-loop — are now capped
  at 30 requests/user/min (`OE\Access::throttle()`), so a single account can't
  run up the bill.

## 1.63.0 — performance: quick wins (P1/P2/P4)

- **`/stats` dashboard endpoint:** primes the postmeta cache in one query before
  reading each event's status — ~500 individual `SELECT`s → 1–2 on the most-hit
  KPI endpoint (backs both dashboards).
- **Settings option:** no longer **autoloaded** (it's a large, plugin-path-only
  option), and `Settings::get()/all()` now **memoize** the merged array in-process
  instead of rebuilding the ~60-key defaults on every call (~20×/request via the
  brand + feature lookups). `Features::all()` reads the map once.
- **Admin ticket tables** (Registrations, Sales, Waitlist, Check-in log, Promo
  codes) prime the post cache for their event column — N per-row title queries
  → 1 per screen.

## 1.62.0 — security: stop echoing saved secrets in Settings (S2)

The Settings page no longer renders your **decrypted** API keys back into the
page HTML. Saved secrets (Stripe, PayPal, Claude, Maps, SES, AWS, GitHub) now
show a **"•••••••• saved — leave blank to keep"** placeholder instead of the
real value, so they're never exposed to the browser / extensions / cached DOM.
Saving with a field left blank **keeps the existing key**; only a newly-typed
value overwrites it (`Settings::keep_secret()`). Keys are still encrypted at
rest and wp-config constants still win.

## 1.61.0 — security: harden door check-in (S1)

Closes the highest-risk finding from the security audit:

- **Random per-event PIN.** The check-in PIN is no longer the event's post ID
  (which is public and guessable). Each event gets a **random 6-digit PIN**,
  generated and stored on first use and shown in the same Tickets & check-in
  box. Events still on the old default regenerate automatically.
- **Brute-force throttle now keys off the real client IP** (`CF-Connecting-IP`
  behind Cloudflare, else `REMOTE_ADDR`) instead of the spoofable
  `X-Forwarded-For` — so an attacker can't rotate a fake IP per request to evade
  it. Hardens every rate limiter, not just check-in.
- **Manifest ships token *hashes*, not raw tokens.** Ticket tokens are the
  admission credential; the offline scanner now hashes the scanned QR
  (SHA-256, via the same secure context it needs for the camera) and matches
  locally, so a leaked manifest can no longer forge or clone tickets.

## 1.60.0 — settings page reorganised into tabs

The Settings screen was a wall of ~20 accordions in two vague columns. It's now a
**left sub-nav with one panel at a time**: **General · Events · AI · Platform
theme · Keys & platform · Email & SMS · Updates**. The last-used tab is
remembered. Sections for **switched-off features are hidden** (e.g. the Volunteer
reminders section disappears when Volunteers is off). All fields, keys and the
test tools are unchanged — only the layout moved.

## 1.59.0 — per-site feature toggles

The plugin runs on several sites that don't all use the same modules. **Settings
→ Features** now lets each site switch modules off — **Tickets, Directory,
Destinations, Products, Stories, Accounts, Volunteers, Contacts & email**.
Everything is on by default; switching one off:

- **hides its wp-admin menu** (and its event meta boxes),
- makes its **public shortcodes / routes inert** (e.g. an unused ticket checkout,
  the `/checkin` app, or the volunteer signup form stop rendering),
- and tells the **companion platform** to drop it from the nav (served via the
  `oe/v1/brand` endpoint, which now includes a `features` map).

Non-destructive — nothing is deleted; flip it back on and it returns. Dashboard,
Events and Settings are always available. New `OE\Features`.

## 1.58.0 — volunteer: branded emails, grouped shifts, auto-confirm

- **Branded volunteer emails.** The signup / confirmed / declined / reminder
  emails now use the same print-first design as the ticket confirmation — a logo
  header (the linked event's logo when set, else the brand logo), a bordered
  shift-detail block (Opportunity / Shift / Location), and a "View details"
  button. New `Transactional::volunteer_email_html()`.
- **Shifts grouped by day.** The public signup widget now groups shifts under
  **day headers** (e.g. "Saturday, October 3") and shows just the **time range**
  per row, so days vs times are clear. Sorted by start time.
- **Auto-confirm.** Public signups are now **confirmed on signup** (no longer
  Pending) and the volunteer is notified immediately; staff can still
  decline/no-show from the Volunteers screen.

## 1.57.4 — fix: volunteer signup rejected ("Error")

The `/volunteer-signup` route still required the old single `shift_id`
parameter, so multi-shift submissions (which send `shift_ids[]`) were rejected
by WordPress before the handler ran — surfacing only a generic "Error". Made
`shift_id` optional at the route (the handler already requires at least one
shift), so signups go through. The widget now also shows the real server
message and handles network errors.

## 1.57.3 — fix: volunteer multi-shift selection not detected

The signup form rejected submissions with "Please choose at least one shift"
even when shifts were ticked: the shift checkboxes render in the table (a
sibling of the `<form>`), so the query scoped to the form found none. Now the
whole widget is queried, so selected shifts are picked up.

## 1.57.2 — easier shift editor + automatic "fully booked"

- **Shift editor is now proper fields.** The opportunity's shifts are entered as
  **Label / Start / End / Capacity** inputs (start &amp; end are date-time
  pickers) with a **"+ Add another shift"** button and a remove ✕ per row —
  replacing the error-prone pipe-delimited textarea. Existing signups stay
  attached (each row keeps its shift id).
- **"Fully booked" everywhere.** When every shift is full, the public signup
  widget shows a **"Fully booked"** notice (and hides the form), and the
  opportunity's **`fully-booked` switcher field flips on automatically** — and
  back off when a spot frees up (decline/remove). Driven by
  `Volunteers::sync_fully_booked()` on every signup change. (Switcher values
  default to JetEngine's `true`/`false`; override via the `oe_fully_booked_values`
  filter if yours differ.)

## 1.57.1 — volunteer signup: multi-shift + always-on reminders

Two tweaks to the public volunteer signup widget:

- **Pick more than one shift.** The shift chooser is now **checkboxes**, so a
  volunteer can sign up for several sessions in one submission. The endpoint
  accepts `shift_ids[]` (still back-compatible with a single `shift_id`), books
  each, and reports how many went through (and any it couldn't, e.g. a shift
  that filled up).
- **Reminders are no longer optional.** Removed the "Text me shift reminders"
  opt-out — everyone gets email reminders, and **providing a mobile opts that
  number into SMS reminders** (with a clear note on the form). Cuts no-shows.
- **Chrome-free widget.** The signup widget now renders **transparent** (no card
  background, header fill, rounding or row lines) so you can place it on your own
  background and border. Input field borders are kept for usability.

## 1.57.0 — link volunteer opportunities to events

Volunteer opportunities stay their own rich listings (a single event can have
several roles, plus festival-wide roles), but can now **optionally link to an
event** so you stop re-typing details:

- **"Linked event"** picker on the opportunity editor. When set, the opportunity
  **inherits the event's location** (leave Location blank to use it).
- **On the event editor**, a new **Volunteers** box lists the opportunities
  linked to that event — role, coverage (filled/capacity), and how many signups
  need a decision — with a **"+ New volunteer opportunity"** button that
  pre-links the new opportunity to the event.
- **`[oe_event_volunteers]`** shortcode surfaces an event's open opportunities on
  its public page (cards linking to each, with live spots-left), so attendees
  can volunteer straight from the event.

New `Volunteers::linked_event()` / `location()` / `for_event()`; opportunity
summaries now carry the linked `event_id`. No change to the existing signup
flow, CPT, or data — the link is purely additive.

## 1.56.1 — resend confirmation / tickets

A **Resend** button on each paid registration (Tickets → Registrations)
re-sends the buyer their confirmation email — tickets, QR codes and the `.ics`
— for when they've lost or never received the original. Reuses the same
branded email; a notice confirms it went.

## 1.56.0 — redesigned ticket & confirmation email (+ per-event logo)

The printable ticket and the confirmation email are redesigned in a clean,
print-first style — square corners, near-monochrome, the brand accent used only
on the numbered badge.

- **Per-event logo.** Each event's **Tickets & check-in** box now has a
  **Ticket & email logo** picker. That logo appears top-left on the printable
  ticket and at the top of the confirmation email. Falls back to your global
  brand logo, then to the brand name, if none is set. (`TicketTypes::logo_url()`,
  meta `_oe_ticket_logo`.)
- **Ticket page** (`/?oe_ticket=…`): black "Print and bring this ticket" bar, a
  bordered card with the logo + QR, a divider, the event title, **date/time
  range**, ticket type, description &amp; price, attendee name, a **Valid /
  Checked-in** status, and a numbered accent badge. No barcode.
- **Confirmation email**: matching language — logo header with the order number,
  a bordered **event summary** (date/venue + the add-to-calendar note for the
  attached `.ics`), and one monochrome **ticket card** per admission (QR +
  attendee + type + a "View ticket" button). New `Transactional::ticket_email_html()`;
  `send()` gained a `$wrap` flag for self-styled documents.

## 1.55.0 — PayPal checkout (alongside card)

Buyers can now pay with **PayPal** as well as card. PayPal appears on the
checkout under the card option (or on its own) whenever it's configured, and is
completely hidden until then — card checkout is untouched.

- **Same trust model as Stripe (ADF-01).** The server prices the cart, creates
  the PayPal order, and stashes the trusted cart/buyer/attendees server-side
  (keyed by the PayPal order id). On approval it **captures via PayPal's API**
  and issues tickets only for what was actually taken — the browser never
  dictates price or contents. Idempotent on the capture id.
- **Refunds included.** The one-click **Refund** button now refunds PayPal
  orders too (via the capture id), emailing the customer just like Stripe.
- **Setup:** Settings → Tickets → **PayPal** — enable, pick Sandbox/Live, and
  paste the **Client ID**; add the **Client secret** under API keys (or pin it
  with the `OE_PAYPAL_SECRET` constant). Sandbox first, then flip to Live.

New `OE\Connectors\PayPalConnector`; `POST /paypal-create` + `/paypal-capture`;
`create_ticket_order_from_meta()` now takes the payment method.

## 1.54.0 — refund/cancel now emails the customer automatically

The one-click **Refund** (Stripe) and **Cancel** actions on Tickets →
Registrations now **notify the buyer automatically**:

- **Refund** → emails a refund confirmation (with the amount and a note that it
  takes 5–10 business days and the tickets are now void).
- **Cancel** (no refund) → emails a cancellation notice.

No extra clicks — it's still one button with a confirm step (the confirm text
now spells out that the customer will be emailed). The existing Stripe refund
and waitlist auto-notify are unchanged. New `order_refunded` /
`order_cancelled` transactional emails.

## 1.53.0 — attendee CSV export (the door list)

The Tickets → Registrations screen now exports **two** CSVs:

- **Export attendees** — one row per ticket: event, **attendee name**, ticket
  type, ticket number, buyer name/email, order #, ticket status, and **live
  check-in status** (checked in Yes/No, time, and door). This is the roll-call
  list staff actually want at the door.
- **Export orders** — the existing financial view (one row per order).

Both now **respect the event filter** (`?event=`), so you can export just one
event's list, and both ship a UTF-8 BOM so Excel renders accented names
correctly.

## 1.52.0 — calendar invite + pre-event reminder email

Two no-show reducers for ticketing:

- **"Add to calendar" (.ics).** Every ticket confirmation email now carries a
  calendar invite for the event (title, start/end, location, link), so buyers
  can drop it straight into Apple/Google/Outlook calendars. Built from the
  event's planning fields (`start_datetime`/`end_datetime`/`location`, with the
  JetEngine field-map fallback); if an event has no date the email still sends,
  just without the file. New `OE\Ticketing\Ics`.
- **Pre-event reminder.** An hourly scan emails everyone with an active ticket a
  short "see you soon" a configurable number of hours before the start (default
  **24h**), with the same calendar invite attached. Sent **once per event**
  (idempotent post-meta flag, so a duplicated cron never double-emails). Toggle
  + lead-time live under **Settings → Tickets → Pre-event reminder**. New
  `OE\Ticketing\AttendeeReminders`, run from the hourly cron.

`Transactional::send()` now accepts attachments; new `event_reminder` email.

## 1.51.0 — check-in works offline (Wi-Fi-proof door scanning)

The door scanner no longer depends on a live connection. If the venue Wi-Fi
drops mid-shift, scanning keeps working and **nothing is lost**:

- **Token manifest cached on PIN entry.** When staff unlock an event, the app
  downloads every valid ticket token (+ who's already in) and stores it in
  IndexedDB. Offline scans validate against that cache — recognised, wrong, or
  already-scanned — with no server round-trip. Tiny even at ~1,000 tickets.
- **Persistent scan queue.** Offline check-ins are written to device storage and
  **survive the app being closed** — they sync automatically the moment
  connectivity returns, *including the next time the app is opened*. Each carries
  its real scan time, so the log shows when people actually arrived. The server
  re-validates and dedupes on sync (two offline doors reconcile — first kept,
  repeats flagged).
- **Service worker** caches the app shell so `/checkin` opens with no signal. It
  only intercepts its own shell/assets — transparent for the rest of the site.
- **Clear status.** A header pill (🟡 Offline · N queued / 🔄 Syncing) and an
  offline banner reassure staff that tickets still scan and will sync later.

New `CheckIn::manifest()` + `GET /checkin-manifest` and `POST /checkin-sync`.

## 1.50.1 — check-in app: home-screen icon & title

The `/checkin` web app now carries proper add-to-home-screen metadata, so saving
it to an iPhone/Android home screen uses **your site icon and name** (with a
"— Check-in" title) instead of a generic "Door check-in" label. Adds
`apple-touch-icon`/`icon` from the site icon, `apple-mobile-web-app-title`,
status-bar + theme-color (`#0f0f0f`), and `viewport-fit=cover` for notched
phones.

## 1.50.0 — Ticket Sales dashboard (30-day chart)

A new **Sales** tab on the Tickets screen: KPI cards (tickets & revenue, all-time
and today), a **30-day tickets-sold bar chart** (hover a bar for that day's count
+ revenue), and a **sales-by-event** table linking through to each event's
registrations. New `Orders::daily_sales(30)`.

## 1.49.0 — QR code in the ticket confirmation email

Each ticket in the confirmation email now shows a **scannable QR code** (plus the
"view" link), so attendees can be checked in straight from the email without
opening the ticket page. Rendered via a QR image service so it displays in every
email client.

## 1.48.0 — waitlist auto-notifies when a seat frees up

When an order is **cancelled or refunded**, everyone still waiting for that event
is now **emailed automatically** — first come, first served — instead of waiting
for staff to hit "Notify". Each person is marked notified so a later cancellation
won't email them twice. (`Waitlist::notify_all_for_event`, called from
`Orders::cancel`.)

## 1.47.1 — the test ticket is now a viewable ticket page

The built-in test ticket now opens as a **real ticket page** at
`/?oe_ticket=OE-TEST-TICKET` (with the QR) — open it on one phone and scan it
from another running `/checkin` for a realistic "scan someone in" demo. The
**Tickets → Check-in log** test panel links straight to it.

## 1.47.0 — built-in check-in test + "All events" nav

- **Always-available test** for demoing/verifying the door scanner. The check-in
  app lists a **🧪 Test (scanner check)** event first; PIN `0000`, a "Test door",
  and scanning the **test QR** returns a green "✓ Welcome, Test Attendee". It's
  virtual — nothing is written to the DB, and there's no public/indexed event.
  The scannable **test-ticket QR + instructions** appear on **Tickets → Check-in
  log**. (For a full purchase→ticket→scan demo, add a comp registration on a real
  event and scan its emailed ticket.)
- **Check-in nav:** an **"← All events"** link in the app header on every step
  after the first, so staff can jump back to the event picker any time.

## 1.46.1 — Event readiness no longer duplicates the event builder

On the event editor, the **Event readiness** box kept its own copy of the event
fields (title, dates, price, location, …) — duplicating a JetEngine-style event
builder. Now, when an **event field mapping is configured** (Settings → Event
field mapping), the readiness box shows just the **status + checklist + Confirm**
(checking the mapped builder fields) and hides the duplicate inputs. Sites with no
builder/mapping still get the planner fields, so nothing breaks. (Saving is guarded
so hidden fields are never wiped.)

## 1.46.0 — checkout: buy a mix of ticket types in one order

The checkout is now a true **multi-line cart**. Previously picking one ticket type
cleared the others (single-type only); now each row keeps its own quantity, so a
buyer can take e.g. 2× Single + 1× Student in a single order/payment.

- Each ticket row's ± stepper is independent; the Order Summary lists **one line
  per type** and sums the total. Promo discount applies to the whole subtotal.
- Attendee-name fields cover **every admission across all lines**.
- Backend: checkout endpoints accept a `cart` ([{type_key, qty}]); the cart is
  priced server-side and issues **one order per line under a single Stripe
  payment** (`Orders::create_cart`), with cart-level idempotency. Single
  `type_key`/`qty` requests still work (back-compat).

## 1.45.1 — Dashboard "Scan tickets" points to the clean /checkin URL

The Dashboard's **Scan tickets** button fell back to `/?oe_checkin=1`; it now uses
the clean **`/checkin`** permalink (a custom scanner page still wins if set).

## 1.45.0 — checkout rebuilt to match Event Tickets v1.2.5 exactly

The earlier restyle was copied from a **stale v1.0.0** of the old plugin in the
repo. Recovered the real **v1.2.5** from git history and ported its checkout
**verbatim** — the design that was actually live and perfected:

- The **699-line v1.2.5 `checkout.css` copied unchanged**, plus its exact markup
  (kept the original `.oct-` classes): full-width ticket rows with inline **± qty
  steppers**, struck-through sale prices, the order-summary box, two-column
  **Your Details**, the **Stripe "Pay Securely"** button + badge, and the orange
  primary buttons.
- **Per-attendee name fields** (appear when the quantity > 1, respecting
  `qty_per_purchase`) — threaded through to each issued ticket's `attendee_name`
  (free orders directly; paid orders via the PaymentIntent metadata).
- **Terms & Conditions** checkbox (when a *Settings → Checkout Terms & Conditions
  URL* is set) gating payment.
- **Sold-out → "Join Waitlist"** modal wired to `/waitlist-join`.
- **"Complete Registration"** path for free (\$0) tickets.

Wired to the existing `oe/v1` ticket endpoints + Stripe; no payment-flow change.

## 1.44.0 — event waitlist

Closes the last ticketing-parity gap. When a ticket type is **sold out**, the
checkout now offers **"Join the waitlist"** (name + email) instead of a dead end.

- New `wp_oe_waitlist` table + `OE\Ticketing\Waitlist` model (DB → v10).
- Checkout: sold-out types stay selectable and swap the buy flow for a waitlist
  join form; `POST /waitlist-join` records it (rate-limited, de-duped).
- New **Waitlist** tab on the Tickets screen: everyone waiting, in queue order,
  filterable by event, with **Notify** (emails them a checkout link and marks
  them notified) and **Remove**.
- New `waitlist_spot` transactional email ("a spot opened up — get your tickets").

## 1.43.0 — check-in app: pretty /checkin URL + original dark design

The door check-in app now lives at a clean **`/checkin`** URL (volunteers can find
it easily) and is restyled to match the original Event Tickets check-in app:

- **`/checkin`** pretty permalink (rewrite rule, auto-flushed once per version) —
  `/?oe_checkin=1` still works as a fallback.
- **Dark, full-screen PWA** ported from the original: app header with a live
  scan-count badge, **event cards**, a big **PIN keypad** with dot display,
  **venue cards**, and a camera **scanner with the framed overlay** + green/amber/red
  result flashes and live per-venue stats. Self-contained `assets/css/checkin.css`,
  scoped under `.oe-checkin`.

## 1.42.0 — checkout restyled to match the original Event Tickets design

The `[oe_event_checkout]` page now carries over the carefully-styled look of the
old Event Tickets plugin: gold-accented **ticket cards** with a selected ✓ state,
a **± quantity stepper**, a clean **order summary**, the **"Secured by Stripe"**
badge, and a **success screen** with the gold check icon. Ported as a dedicated,
self-contained `assets/css/checkout.css` (scoped under `.oe-checkout`, so it
touches nothing else), with matching markup in the template and `checkout.js`.

## 1.41.4 — auto check-in PIN, a built-in check-in page, promo editing

Ticketing fixes following the parity review:

- **Check-in PIN auto-derived from the event's post ID.** Every event now has a
  working PIN automatically (the post ID); the Events list column and the
  check-in app use it. A PIN typed into the event's meta box still overrides it.
- **Built-in check-in page** at `/?oe_checkin=1` — a guaranteed door check-in URL
  (PIN → venue → scan) without having to place the `[oe_checkin]` shortcode on a
  page. The Dashboard's **"Scan tickets ↗"** button now always appears (using the
  scanner page if set, otherwise this built-in route). Works with zero setup —
  the venue step defaults to "Main door".
- **Promo codes can be edited** — each code has an **Edit** button that loads it
  into the form (the save path already supported updates).

## 1.41.3 — Check-in Log admin screen

Restores the old plugin's **Check-in Log**. A new **Check-in log** tab on the
Tickets screen lists every recorded door scan — attendee, ticket type, ticket
number, door/venue and time — filterable by event and paginated. Picking an event
also shows that event's per-venue scan breakdown and unique-attendee count. (The
data was already being recorded in `wp_oe_checkins`; this exposes it in wp-admin.)

## 1.41.2 — keep the old [oct_checkout] checkout pages working

The retired "Event Tickets" plugin's live checkout pages use `[oct_checkout
event_id="…"]`. October Events only aliased the older `adf_*` tags, so with that
plugin switched off those pages rendered nothing. Added an `oct_checkout →
oe_event_checkout` shortcode alias so existing published checkout pages keep
working unchanged. (See `docs/october-events/TICKETING-PARITY.md` for the full
old-vs-new ticketing audit.)

## 1.41.1 — Check-in PIN column on the Events list

The Events planning list now shows each event's **Check-in PIN** as a column, so
staff can see every event's door PIN at a glance instead of opening each event.
(The check-in scanner link stays a single "Scan tickets ↗" button on the
Dashboard/Tickets — one link, per-event PINs.)

## 1.41.0 — subscriber growth graph

A **Growth** tab on the platform Contacts screen charts **new contacts per month**
(by the date we first recorded them). It **excludes the one-time Brevo/CSV imports**,
so it reflects genuine growth from launch onward rather than an import-day spike —
the way to learn *when* subscribers actually join. New endpoint:
`GET /contacts/growth`.

## 1.40.0 — contact edit, delete & activity report

Staff can now fully manage a contact from the platform (Contacts → Details):

- **Edit** name, company, tags and phone.
- **Delete** a contact (removes them from all lists).
- **Activity report** — join date, source, status, the lists they're in, and email
  engagement (campaigns received / opened / clicked, with a recent-campaigns table).
- New REST: `DELETE /contact/{id}`, profile-field edits on `POST /contact/{id}`, and
  `GET /contact/{id}/activity`.

## 1.39.0 — send to multiple audiences

Campaigns can now target **several audiences at once** (e.g. two lists + a source).
The `audience` field stores comma-separated keys; the send resolver unions them and
**de-duplicates by email**, so nobody gets two copies. Widened the `audience` column
(DB → v9). The platform's email wizard exposes this as **checkboxes** (Brief and Send
steps), and the wizard now runs full-width with a larger co-pilot brief field.

## 1.38.2 — delete campaigns + co-pilot names the campaign

Groundwork for the new email flow.

- **Delete a campaign** — a ✕ on each campaign card (hover) and a "Delete campaign"
  action in the editor, both with confirmation. (The backend DELETE route already
  existed; this surfaces it.)
- **Co-pilot now names the campaign** too — its draft fills the internal campaign
  name (when blank) alongside the subject and preheader, so a one-line brief
  produces a fully-labelled draft.

## 1.38.1 — Contacts screen split into tabs

The Contacts screen is now tabbed: **Overview** (your list at a glance as KPI cards),
**Lists** (your lists + member counts), **Contacts** (the table), and **Import & clean**
(Brevo import, rebuild, cleanup, plain-CSV — tools last). Less wall, easier to find.

## 1.38.0 — contact CleanUp (names + company from email)

The first half of AI list-building: a deterministic enrichment pass (no API cost).

- **`OE\Mail\Enrich`** derives each contact's **company from their email domain**
  (`jane@perkinswill.com` → *Perkinswill*; skips Gmail/Outlook/etc.) and **tidies
  names** (ALL-CAPS / all-lowercase → Title Case, keeping deliberate casing like
  "DeLeo", handling hyphens, apostrophes and the "Mc" prefix).
- Runs as a **background backfill** (hourly cron) plus a **"Run cleanup"** button on
  Contacts that shows how many remain and processes them in chunks.
- New contact columns `company`, `tags`, `enriched` (DB → v8); exposed in the
  REST DTO and shown as a **Company** column in both the plugin and platform
  contact tables.

Sets up the next step: Claude classifies people (architect / designer / press / …)
into lists using these signals.

## 1.37.0 — contact lists (foundation) + Brevo import

- **Lists** — new `oe_lists` + `oe_list_members` tables and `OE\Mail\Lists` model
  (manual lists now; a `type`/`rules` column is in place for dynamic segments next).
  REST under `oe/v1/lists` (CRUD, add/remove members, import-CSV-to-a-list), and
  the contacts list endpoint can filter by `?list=ID`.
- **Campaigns can target a list** — lists appear as audiences (`list:<id>`) in the
  builder and resolve to their subscribed members on send.
- **One-shot Brevo import** — upload your Brevo export (the CSV with `_listIds`) on
  the Contacts screen; it captures every contact (name, phone), respects
  email/SMS consent, and **auto-creates &amp; assigns all your lists** (Subscribers,
  Event — Tours, Volunteers, …) by their Brevo IDs. Idempotent — safe to re-run.
- Plugin Contacts screen now shows your lists + member counts. DB schema → v7.

## 1.36.1 — updater: rate-limit back-off + balanced cache

- The self-updater now **backs off when GitHub rate-limits the token** — it reads
  the `X-RateLimit-Reset` header and waits until the limit resets (capped at an
  hour) instead of retrying and making it worse. (This was the cause of updates
  not appearing: a 403 "API rate limit exceeded", not a token problem.)
- Release-lookup cache rebalanced to **1 hour** (down from 3) — responsive without
  hammering the API. The Updates "Check again" / force-check path and the
  Settings → Updates "Test update connection" button still check instantly.

## 1.36.0 — two brand-font weights; admin polish

- **Two font uploads** in Settings → Branding: a **Body font (regular)** and a
  **Heading font (bold)**. Both register as `@font-face` under the same family — the
  regular covers body weights, the bold covers headings — so type is easier to read.
  Exposed via `oe/v1/brand` (`font_url`, `font_url_bold`) and applied in both the
  plugin admin and the platform. Leave bold blank to use the regular for everything.
- **Removed the heavy underline** beneath admin page titles (the bento sits right
  below, so the rule was redundant).
- **Platform Contacts**: the full list renders below the search and is hardened so a
  single malformed record can't blank the table.

## 1.35.0 — approval queue fully on the Dashboard; Contacts tidied

- **Approval queue** now lives **only on the Dashboard** — the standalone Approval
  Queue menu item and page are removed. The Dashboard's "Approval queue" panel is
  always shown (with a friendly empty state when nothing's pending) and lists up to
  50 items with inline Approve/Reject. The "By listing type" rows now link to that
  type's manage screen.
- **Contacts** redesigned: the management controls sit in a white bordered panel
  split into three columns with sub-headings — **Your list** (counts), **Rebuild**,
  and a smaller **Import a CSV** — with the full contact list below.
- **Settings** accordions now all start **collapsed**.

## 1.34.0 — Email moves to the platform; tools fold into Settings

Completing the "campaigns live in the platform" split.

- The standalone **Email** admin screen is removed from the menu. Its setup tools
  move into **Settings**: SES transport status + **send-a-test** + **recent log** +
  **send digest now** are now under Settings → *Email tools — test, digest & log*
  (and the SES config stays in Settings → Email sending). Campaign building was
  already in the platform; the Dashboard's "Open the platform" button is the way in.
- Contact management stays on its own **Contacts** screen; the Dashboard action bar
  now links there.

## 1.33.0 — Settings: two columns, grouped, with per-key help

- Settings now lays out in **two columns** — **This site & content** (brand, theme,
  event readiness/mapping, pricing, rejection copy, AI Stories, support chat) and
  **Connections & system** (API keys, platform/CORS, SES, digest, reminders, SMS,
  Chatwoot, updates) — to cut the scroll. Stacks to one column on narrow screens.
- **Per-API-key help** under each field: where to get it and what to paste. The
  **Stripe webhook** hint shows this site's live endpoint URL
  (`…/wp-json/oe/v1/stripe-webhook`) and the exact events to send
  (`payment_intent.succeeded`, `charge.refunded`).
- Tidy-up: removed a stale duplicate SMS sender/enable control from the reminders
  section (the real toggle lives in the SMS section); retitled the page "Settings".

## 1.32.0 — approvals on the Dashboard

The Dashboard now shows a **"Needs your approval"** panel listing pending
submissions with inline **Approve / Reject** (the same actions as the queue, and
they return you to the Dashboard). The full Approval Queue page stays for
filtering. One less click for the most common daily action.

## 1.31.0 — admin menu consolidation (phase 1)

Streamlining the plugin admin toward "setup & data here, staff ops in the platform".

- **Events** — the readiness board is now the single Events screen; the redundant
  raw Events list is removed from the menu (events still editable via their rows).
- **Tickets** — Promo codes are now a **tab** inside Tickets (Registrations |
  Promo codes); the standalone Promo Codes menu item is gone.
- **Tasks** removed from the plugin menu (it's a platform/staff tool; its data +
  REST stay so the platform is unaffected).

Still to come: surfacing the approval queue on the Dashboard, moving Email's
deliverability tools into Settings (then dropping the Email menu item), a platform
"create opportunity" action so Volunteers can leave the plugin menu too, and the
Settings reorg (grouped by page, two columns).

## 1.30.0 — platform link + Volunteers create button

- The **"Open the platform"** buttons now prefer your real custom domain over the
  `*.pages.dev` build host when no explicit Platform URL is set (set one in
  Settings to override). Fixes the button pointing at `october-platform.pages.dev`.
- **Volunteers** gains a **+ New opportunity** button (Tasks, Promo Codes and
  Tickets already had inline create forms).
- De-branded the event ticket meta box title ("ADF — Tickets" → "Tickets &
  check-in") where the ticket types, venues and the **check-in PIN** are set.

## 1.29.0 — Settings as accordions

The Settings screen is now a stack of collapsible **accordion** sections (Brand,
Event readiness, Field mapping, API keys, Pricing, AI Stories, … Branding, plus
Test the voice and Test update connection) instead of one very long page. Brand
opens by default; deep-links like `…/oe-settings#platform` auto-open and scroll to
their section. All field names are unchanged — saving works exactly as before.

## 1.28.0 — Email screen rethink + contacts pull in users

- **Email** screen rebuilt into clear panels: a "design &amp; send in the platform"
  callout with a button that **opens the platform email builder in a new tab**,
  then SES transport status + test + log, audiences, the monthly digest, and —
  at the bottom on the same page — **contact management** (count cards, rebuild,
  recent list, manage link).
- **Contacts now include all WordPress users** — `backfill()` pulls every user
  (customers, staff) into the contact list (source `user`), alongside accounts,
  ticket buyers, volunteers and submitters.

## 1.27.0 — admin redesign: dashboard + tables match the platform

Making wp-admin feel like the planning platform.

- **Dashboard** is retitled "Dashboard", leads with the same **4 headline KPI
  cards** as the platform (tickets + revenue this year, subscribers, events
  confirmed), and gains an action bar: **+ New event**, Review submissions, Email,
  plus **Scan tickets ↗** and **Open the platform ↗** buttons when configured.
- **Unified tables** — every admin table now uses the calmer, padded,
  card-style "getting-started" look (no harsh zebra), with hover and chip statuses.
- **Create affordances** — primary **+ New / + Add** buttons on the Dashboard,
  Accounts and every listing screen, plus friendly empty states.
- **New settings** — *Platform URL* (for the "open in the platform" buttons) and
  *Check-in scanner page* (where `[oe_checkin]` lives, so a Scan tickets button can
  link straight to it).

## 1.26.0 — headline KPI feed for the dashboards

- New staff endpoint **`GET oe/v1/stats`** returns the festival's headline numbers:
  tickets sold and revenue **this year**, total email subscribers, and event
  readiness (confirmed / total), plus all-time totals and currency.
- `Orders::stats()` gains **this-year** ticket + revenue figures.
- Powers the redesigned dashboards (platform + plugin admin) so both show the same
  key data.

## 1.25.0 — human hand-off from the support chat

The public support chat now has a clear escape hatch to a real person.

- A **“Talk to a person”** button in the chat header. When Chatwoot is configured
  (existing settings), it opens the site's Chatwoot widget pre-filled with the
  customer's verified email and tags the conversation as coming from the bot — so
  an agent picks up with full context. With no Chatwoot, it falls back to a
  pre-filled support email (`mailto:` with the email + transcript).
- The assistant's system prompt now invites the customer to use that button
  whenever they want a human or it can't help.

Closes the loop on the three-part chat plan: staff assistant (1.23.0) → public
customer chat (1.24.0) → human hand-off (this release).

## 1.24.0 — public AI support chat (customer-scoped)

A floating "Need help?" chat on the public site that answers customers' detailed
questions about **their own** orders and tickets instantly — without ever exposing
anyone else's data.

- **Verification first** (`OE\AI\SupportAuth`) — the visitor enters their email and
  gets a 6-digit one-time code by email; the response is identical whether or not
  that email has orders, so the endpoint can't be used to enumerate customers.
  Codes are stored hashed, expire in 15 minutes, cap wrong attempts, and the whole
  flow is rate-limited per IP. A verified code mints a short-lived HMAC-signed
  session token scoped to that exact email.
- **`OE\AI\PublicAssistant`** — Claude with tool-use, but every tool is hard-scoped
  to the verified email (the scope is bound into the executor, never taken from the
  model or the conversation). Tools: my orders, my tickets, one order's detail,
  event info (only for events the customer holds tickets to), and resend-tickets
  (to their own verified address only). The system prompt forbids discussing any
  other customer's data and offers a human hand-off for anything out of scope.
- **Public REST** `oe/v1/support/request-code`, `/support/verify`, `/support/chat`
  — public endpoints that rate-limit and re-verify the token on every turn.
- **Frontend widget** (`OE\Frontend\SupportChat`) — a self-contained, dependency-free
  floating chat (or inline via the `[oe_support_chat]` shortcode), enabled with a
  single **AI support chat** toggle in Settings. Only loads when a Claude key is set.

Built on the same engine as the staff assistant (1.23.0), but locked to one
customer. The optional Chatwoot human hand-off remains available alongside it.

## 1.23.0 — staff AI assistant (live data, tool-use)

A staff-only AI assistant that answers detailed operational questions instantly by
looking things up in the live data — no dashboards to hunt through.

- **`OE\AI\Assistant`** — Claude with tool-use over the festival's own data. Eight
  tools: events overview, single-event readiness, ticket sales (today + all-time +
  per event), order lookup (by email / order id / Stripe payment id), recent failed
  card payments (from Stripe), contact search, volunteer coverage, and campaign
  stats. The model is told to use tools and answer with real numbers, never guess.
- **`ClaudeConnector::converse()`** — runs Anthropic's tool-use loop (ask → run the
  requested tool → feed the result back → repeat, capped at 6 rounds).
- **`StripeConnector::recent_failed()`** — recent failed charges with amount, email
  and failure reason.
- **REST** `POST oe/v1/assistant` (`current_user_can('edit_posts')`) — takes the
  running conversation, returns the reply.
- **Platform** gains an **Assistant** view: a chat with suggestion chips, a typing
  indicator and lightweight markdown rendering. Read-only — it can see everything
  but changes nothing.

This is the staff engine; the public, per-order-scoped customer chat (verified by
email + confirmation) reuses it and lands separately.

## 1.22.0 — richer email builder (columns, social, alignment)

The campaign builder gains the blocks needed for proper newsletters (matching the
kind of email the team sends):

- **2-column block** — image + text side by side, in a fluid-hybrid layout that
  stacks on narrow screens without media queries.
- **Social block** — a row of follow links, each with an optional icon picked from
  the media library (falls back to a text link).
- **Alignment** (left / center / right) on heading, text, image and button.
- The **Claude co-pilot** can emit these too — its block schema + validator now
  cover `columns`, `social` and `align`.

(Platform builder UI + plugin co-pilot schema; no schema change.)

## 1.21.0 — go-live gaps (event mapping, CSV import, resilient sending)

Closes the practical gaps before connector setup:

- **Event field mapping** — Settings → Event field mapping lets you point the
  planner at your existing (e.g. JetEngine) meta keys for dates/price/location/…
  The confirm→green readiness then reads them when its own field is empty, so
  existing events show real progress instead of 0%. A **Seed planning from
  existing fields** button on Event Planning copies them in as editable values
  (non-destructive).
- **Contact CSV import** — Contacts screen now imports a CSV (e.g. a Brevo
  export); detects email + optional name/first/last/phone columns. Closes the
  last migration gap.
- **Resilient campaign sending** — besides the per-minute cron, a throttled
  traffic-driven fallback drains the send queue (and an immediate kick on send),
  so campaigns still go out on a low-traffic site where WP-cron is unreliable.
- No schema change.

## 1.20.1 — design fixes

- **Admin styles never loaded when the menu was renamed.** The admin CSS was
  enqueued by matching the page *hook*, but WordPress builds that hook from the
  (brand-named) parent menu — e.g. `festival_page_oe-queue` — so it never
  matched and wp-admin stayed unstyled (no design, unstyled bento). Now matched
  on the `page` query param (`october-events` / `oe-*`) + our CPT screens.
- **Platform page-guide bento lost its background.** Its CSS referenced
  `--side` / `--ink` / `--muted`, which aren't tokens in the design system —
  fixed to `--text` / `--text-muted` so the dark bento renders correctly.

## 1.20.0 — "what you can do" guide on every screen

Every admin screen now opens with a dark **intro bento** — a one-line "what you
can do here" + a numbered set of steps — matching the platform's hero style, so
anyone landing on a page understands it at a glance. (The platform's pages get
the same, dismissible, guide.)

## 1.19.0 — upload your own brand font

Branding now takes an **uploaded font file** as well as a stylesheet URL — for
sites that self-host their type (no Google Fonts).

- **Settings → Branding**: a family-name field + an **Upload / choose font**
  button (media library) for `.woff2 / .woff / .ttf / .otf`. Font MIME types are
  allowed for uploads (admins only).
- The uploaded file is registered as `@font-face` and applied in **both** the
  platform (via `oe/v1/brand` → `font_url`) and the wp-admin screens; blank falls
  back to Brockmann. The old "stylesheet URL" option remains as an alternative.

## 1.18.0 — admin redesign (October design system)

The wp-admin screens now match the platform's October "Marketing Intelligence"
look (minus the sidebar — wp-admin has its own): self-hosted **Brockmann**,
off-white canvas, white bento cards with 2px soft-grey borders, big display
titles and brand-yellow pill buttons. Scoped to `.oe-admin`, so the rest of
wp-admin is untouched; the accent follows **Settings → Branding** per site.

## 1.17.0 — SMS (AWS) + live chat (Chatwoot), ready to switch on

The last "add it later" services are now built and wired — off until you paste
credentials, so the plugin runs anywhere and these light up from Settings once
your AWS / Chatwoot accounts exist.

- **SMS via AWS End User Messaging** (`OE\Connectors\SmsConnector`): SigV4-signed
  `SendTextMessage` (Pinpoint SMS Voice v2), no SDK. Volunteer-reminder texts now
  route through it; it's a no-op until enabled with an access key / secret /
  region / origination identity. **Settings → SMS** (secret also accepts the
  `OE_AWS_SECRET_ACCESS_KEY` constant). US sending needs a 10DLC number.
- **Live chat (Chatwoot)** (`OE\Chat`): injects the Chatwoot widget site-wide
  when a base URL + website token are set in **Settings → Live chat**; nothing
  loads otherwise.
- **Campaign footer postal address** (CAN-SPAM) is now editable in
  **Settings → Email**.
- No schema change.

## 1.16.0 — contacts in the platform

- **REST** `oe/v1/contacts` (list + search, paginated), `/contacts/meta` (counts)
  and `POST /contact/{id}` (subscribe / unsubscribe) — auth: can-edit.
- New `Contacts::get_by_id()` and `resubscribe()` (the latter also clears the
  address from the suppression list).
- The planning platform gains a **Contacts** view: totals, a search box, a table
  of contacts (email / name / source / status) and a one-click
  unsubscribe / re-subscribe toggle. No schema change.

## 1.15.0 — email co-pilot (Claude drafts campaigns)

Phase 5 of the email platform — the differentiator. Brief Claude in plain
language and it returns a finished campaign as editable builder blocks, in the
trained house voice, grounded in live festival data.

- New `OE\Mail\Copilot`: builds a draft from a brief (+ conversation + the
  current blocks for edits), using the AI Stories voice guide + examples as the
  system prompt and a compact **festival-data context** (confirmed upcoming
  events with dates/price/location/link, recent stories) as the only source of
  facts and links.
- **Guardrails**: output is strict JSON validated against the builder's block
  schema (heading / text / image / button / divider / spacer) and sanitised;
  image blocks come back as placeholders (suggested alt, no URL — you pick the
  real image); button links must be real URLs from the data; unverifiable facts
  become visible `[TODO: confirm …]` placeholders; the model never adds the
  unsubscribe/footer (the sender does).
- **REST** `POST oe/v1/campaigns/copilot` → `{ reply, subject, preheader,
  blocks }`. The platform's campaign editor gains an **AI co-pilot** panel:
  brief it, it fills the subject/preheader and loads blocks onto the canvas;
  follow-up briefs refine the draft in place.
- Reuses the existing Claude connector + tone-of-voice training. No schema change.

## 1.14.0 — retire Brevo (native transactional email)

Brevo is removed. Now that native contacts, SES sending, deliverability and
campaigns are in place, all email is owned by the plugin — no third-party
service, no list-ID mapping.

- New `OE\Mail\Transactional`: branded native HTML templates for every triggered
  email (account welcome, payment confirmed, submission received/approved/
  rejected, ticket delivery, volunteer confirmed/declined/reminder, daily sales
  report), sent through the site Mailer (SES when configured, else the site's
  default transport).
- The **monthly digest** now sends as a native campaign to all subscribers —
  reusing the throttled sender, open/click tracking and one-click unsubscribe.
- **Removed**: the `BrevoConnector`, the Brevo API key, and the Brevo template-ID
  / list-ID mappings in Settings. Contact capture stays (native contacts already
  record every signup); audiences replace the old Brevo lists.
- The **Email** admin screen now shows the transport status, native contact/
  audience counts and the email log instead of Brevo lists.
- **SMS** via Brevo is retired; volunteer-reminder SMS is a no-op until AWS End
  User Messaging lands (email reminders are unaffected). No schema change.

## 1.13.0 — email campaigns: bulk sender + tracking (backend)

Phase 4 (backend half) of the email platform — the campaign engine the platform's
drag-and-drop builder will drive. (The builder UI lands next.)

- New `oe_campaigns` + `oe_messages` tables (DB version → 6): a campaign holds the
  builder block JSON + rendered HTML, an audience, schedule, status and stats;
  one message row per recipient with a tracking token.
- **Audiences** resolved from native contacts — *all subscribers*, *SMS opt-in*,
  or *by source* (account / ticket / volunteer / submission), each with a live
  count.
- **Throttled bulk send**: queuing skips suppressed addresses; a new per-minute
  cron tick (`oe_mail_dispatch`) drains the queue in batches of 100 through the
  site Mailer (SES), so a blast never exceeds send limits. Scheduled campaigns
  auto-start at their time.
- **Compliance built into the send path**: every message gets the
  `List-Unsubscribe` headers + an unsubscribe footer (with the configurable
  physical address), an **open pixel**, and **click-tracking** links (HMAC-signed
  so the redirect can't be abused as an open redirect).
- **REST** `oe/v1/campaigns` (+ `/{id}`, `/{id}/test`, `/{id}/send`) and
  `/audiences` for the builder. **Send test** delivers a no-tracking preview.

## 1.12.0 — deliverability spine (unsubscribe + SES bounce/complaint)

Phase 3 of the email platform — the compliance + list-hygiene plumbing that has
to exist before any bulk send.

- **One-click unsubscribe** (`OE\Mail\Unsubscribe`): a signed, no-login link
  (`?oe_unsub=…&k=…`) + the `List-Unsubscribe` / `List-Unsubscribe-Post` headers
  email clients use for their built-in unsubscribe button (RFC 8058). Hitting it
  adds the address to the suppression list and marks the contact unsubscribed; a
  hosted confirmation page is shown for the GET link.
- **SES bounce/complaint ingestion** (`OE\Mail\SnsController`): a public
  `POST oe/v1/ses-sns` endpoint for the SNS topic SES publishes to. Permanent
  bounces and complaints are auto-suppressed (and the contact unsubscribed),
  keeping bounce/complaint rates low so AWS doesn't throttle. Every message's
  **SNS signature is verified** against the AWS signing certificate first, and
  subscription confirmations are auto-confirmed.
- No schema change (uses the existing suppression + contacts tables).

## 1.11.0 — native contacts (kills the manual import)

Phase 2 of the email platform: a unified, de-duplicated contact list built from
the data the plugin already owns, so contacts never have to be imported by hand
again.

- New `oe_contacts` table (auto-created on upgrade; DB version → 5): email
  (unique), name, phone, sms_opt_in, source, status.
- `OE\Mail\Contacts` — `capture()` (insert/merge, de-duped on email, fills blanks
  only, never silently re-subscribes), `backfill()` from accounts, ticket buyers
  and volunteers, plus search/counts/unsubscribe.
- **Forward-fill**: every account creation, ticket order, volunteer signup and
  listing submission now also captures a native contact (alongside the existing
  Brevo upsert), so the list stays current.
- **Contacts** admin screen: totals (subscribed / unsubscribed / SMS opt-in), a
  recent list, and a one-click **Rebuild from existing data**.
- Honours the suppression list — a suppressed email is captured as unsubscribed.

## 1.10.0 — email foundation: Amazon SES site mailer + log + suppression

Phase 1 of the email platform (see docs/october-events/EMAIL-PLATFORM.md). October
Events can become the site's outgoing-mail transport, so the SMTP/log plugins can
be retired. **Off by default** — until SES is enabled and configured, the site's
mail is untouched.

- **Amazon SES transport**: when enabled, all `wp_mail()` routes through SES via
  SMTP (configured on `phpmailer_init`), with a configurable From name/address.
- **Email log** (`oe_email_log`): every send recorded (to, subject, status,
  driver, error) — replaces "Check & Log Email". Visible under **Email**, with a
  **send-test** button.
- **Suppression list** (`oe_suppression`): unsubscribes/bounces are honoured on
  every send — suppressed recipients are stripped, a fully-suppressed message is
  skipped. (SES→SNS bounce ingestion comes in a later phase; the table + checks
  exist now.)
- **Settings → Email (Amazon SES)**: enable, region, SMTP user/password
  (encrypted at rest, or `OE_SES_SMTP_PASSWORD`), From name/address.
- New tables auto-create on upgrade (DB version → 4). Degrades gracefully: with
  no SES config the mailer is a transparent logger.

## 1.9.0 — platform branding (per-site theme)

The planning platform now adopts the October "Marketing Intelligence" design
system, and each site can override the look from here.

- **Settings → Branding (platform theme)**: accent colour, text-on-accent,
  sidebar colour, page background, light/dark **logo** URLs, and an optional
  **custom font** (family + stylesheet URL). Blank = the built-in October
  defaults (Brockmann + brand yellow).
- New **public** REST endpoint `GET oe/v1/brand` (no auth — the platform's
  sign-in screen themes before login) returns the brand name + any non-empty
  overrides; the platform applies them as CSS variables at runtime.
- No schema change.

## 1.8.3 — CORS: take sole ownership on our routes (beats JetEngine for real)

1.8.2 still lost: JetEngine's `rest_pre_serve_request` CORS callback runs *after*
even a `PHP_INT_MAX` handler, so cleaning up afterwards couldn't win — the live
preflight still returned two `Access-Control-Allow-Origin` values
(`…pages.dev`/custom domain **and** `*`).

- `OE\Cors` now hooks `rest_pre_dispatch` (which runs *before*
  `rest_pre_serve_request`) and, for `/oe/v1` requests only, **removes every other
  `rest_pre_serve_request` handler** — core's origin echo and JetEngine's blanket
  `*` alike — so our handler is the single source of CORS on our routes. Entries
  are unset directly, so closure-based callbacks are caught too. JetEngine's CORS
  is untouched on its own routes.

## 1.8.2 — CORS: win against late header appenders (JetEngine)

Follow-up to 1.8.1. On sites running **JetEngine**, every REST response gets a
blanket `Access-Control-Allow-Origin: *` appended *after* core's CORS — so our
1.8.1 handler (which ran at priority 20) cleaned up too early and the stray `*`
came back, leaving two values and a blocked browser request.

- `OE\Cors` now runs at **`PHP_INT_MAX`** on `rest_pre_serve_request`, so it's the
  last code to touch the headers: it strips the duplicate `Access-Control-Allow-
  Origin` (core's echo + JetEngine's `*`) and emits exactly one value for an
  allowed origin. Only affects `oe/v1` routes; JetEngine's own CORS is untouched
  elsewhere.

## 1.8.1 — CORS for the planning platform

Lets the off-site planning platform SPA call the `oe/v1` REST API from the
browser. WordPress core echoes the request Origin already, but many hosts /
security plugins *also* add a blanket `Access-Control-Allow-Origin: *`, and a
browser rejects a response that carries the header twice ("contains multiple
values … but only one is allowed").

- New `OE\Cors`: for `oe/v1` routes it takes ownership of the CORS headers —
  strips whatever was set (core's echo + a stray `*`) and emits exactly one
  valid `Access-Control-Allow-Origin` for an allowed origin, plus a clean
  preflight (methods, `Authorization`/`Content-Type` headers).
- **Settings → Planning platform (CORS)**: the allowed origins, one per line.
  Defaults to `october-platform.pages.dev` and
  `platform.atlantadesignfestival.net`, so it works out of the box.
- Note: PHP can only override headers it set; if a duplicate `*` is added by the
  web server itself (Apache `Header always set`, nginx `add_header`) it must be
  removed there.

## 1.8.0 — volunteer management API

A REST surface over the existing volunteer signups so the platform can give
Ashleigh a full management view (the same operations as the wp-admin Volunteers
screen, friendlier). No schema change — it reads/writes the existing
`oe_volunteer_signups` table.

- **REST** `oe/v1/volunteers/*` (auth: can-edit):
  - `GET /volunteers/opportunities` — every opportunity with capacity vs filled
    across its shifts and how many signups still need a decision.
  - `GET /volunteers/opportunity/{id}` — shifts (capacity, spots left, full) with
    the signups attached to each.
  - `POST /volunteers/opportunity/{id}/signup` — manually place a volunteer on a
    shift (bypasses the open/capacity gate; staff-placed signups start confirmed
    and still fire the confirmation + reminders).
  - `POST /volunteers/signup/{id}` — set status (confirm / decline / no-show /
    re-open) and/or toggle check-in.
  - `DELETE /volunteers/signup/{id}` — remove a signup.
- New read models on `OE\Volunteers` (`opportunity_summary`,
  `opportunity_detail`, `signup_dto`) and a `for_opportunity` query.

## 1.7.0 — shared Tasks

A shared, department-grouped task list for the whole team (replacing the
single-user Notion board) — org-wide, so it lives on the hub and is exposed to
the platform.

- New `oe_tasks` table (auto-created on upgrade; DB version → 3).
- **Tasks** admin screen: add/edit, grouped by department, inline status change
  (To do / In progress / Blocked / Done), due date, assignee, notes, delete.
- **REST** `oe/v1/tasks` (+ `/task/{id}`, `/tasks/meta`) — list/create/update/
  delete for the platform's Tasks board (auth: can-edit-events).
- Departments default to the festival's existing groups (Admin, Advertising,
  Content Marketing, Email, PR, Media Partners, Partners & Sponsors, Social,
  Website Dev, Website Support, Uncategorized).

## 1.6.0 — event planning + confirm→green (PM platform phase 1)

The first slice of the project-management platform, in the plugin (usable in
wp-admin now; the same data feeds the platform UI later via REST).

- **Confirm→green gating engine** (`OE\Planning\Gating`): an event can only be
  confirmed once the required fields are complete. Default required set = Elayne's
  essentials — **title, dates & times, price, location** — configurable under
  **Settings → Event readiness**.
- **Event planning** (`OE\Planning\Events`): canonical event info + sessions +
  internal notes stored as `_oe_plan_*` meta on the `events` CPT.
- **Event readiness meta box** on each event: a live checklist, the planning
  fields, a sessions list, and a **Confirm — go green** button that's disabled
  until complete. Confirming **publishes** the event to the public site;
  un-confirming returns it to in-progress.
- **Event Planning** admin screen: every event with a completion meter, status,
  and what it still needs.
- **REST** (`oe/v1/planning/*`): list events, read/update one, and confirm — the
  endpoints the platform's Events board will use (auth: can-edit-events).
- No schema/table changes; status auto-drops from green if a confirmed event later
  becomes incomplete.

## 1.5.0 — renamed to October Events (multi-site)

The plugin is renamed from **ADF Festival** to **October Events** so one codebase
can run on multiple sites (Atlanta Design Festival, Architecture Tours, …) under a
per-site brand set in **Settings → Brand**.

- Identifiers renamed: namespace `ADF\` → `OE\`, constants `ADF_*` → `OE_*`, text
  domain, slug (`october-events`), REST namespace (`oe/v1`), shortcodes (`oe_*`),
  release tags (`oe-v*`), and the data identifiers — tables (`wp_oe_*`), options
  (`oe_*`), and post meta (`_oe_*`) / our CPT slugs (`oe_*`).
- **One-time data migration** (`Activator::migrate_legacy()`, idempotent): renames
  the old `adf_*` tables/options/meta and `adf_*` post types to `oe_*` on first
  load — no manual data work.
- **Back-compat shims** (`Compat`): the old `[adf_*]` shortcodes still render, and
  the old `adf/v1/stripe-webhook` URL still works, so live pages and the Stripe
  webhook keep functioning during the transition.
- The encryption-key derivation is kept stable so secrets stored before the rename
  still decrypt.
- **Manual steps for the live ADF site** (slug change ⇒ the self-updater can't
  cross to the new slug automatically):
  1. Upload/activate the **October Events** plugin once (it migrates the data),
     then deactivate the old "ADF Festival" plugin.
  2. Rename any `ADF_*` constants in `wp-config.php` to `OE_*`
     (e.g. `ADF_STRIPE_SECRET_KEY` → `OE_STRIPE_SECRET_KEY`).
  3. Update the Stripe webhook URL to `…/wp-json/oe/v1/stripe-webhook` (the old
     `adf/v1` alias keeps working until you do).
  4. Set the site's display name under **Settings → Brand**.
- No feature changes; ads remain in the standalone oc-ad-manager plugin.

## 1.4.0 — separate the Ad Manager

## 1.4.0 — separate the Ad Manager

- **Removed the ad module from this plugin.** Ads are a cross-site ad network, not a
  festival-specific feature, so they now live solely in the standalone **oc-ad-manager**
  plugin (the festival site runs both). Bundling them in 1.0.0 was the wrong call; this
  corrects it and slims the festival plugin (63 → 48 PHP files).
- Removed: `ADF\Ads\*` (campaigns/creatives/tracking/bookings/serving/partner), the Ads
  admin screens, the `[adf_ad]` / `[adf_ad_book]` shortcodes, the ad REST endpoints
  (`/ad-render`, `/ad`, `/ad-promo`, `/ad-book-intent`) + the webhook `ad_booking` branch,
  the `wp adf migrate-ads` command, and all ad/syndication settings.
- No effect on tickets, listings, volunteers, email/SMS, or the self-updater.
- **Note:** the `adf_ad_*` tables from 1.0.0–1.3.0 are left in place (harmless) rather than
  dropped; remove them manually if you never used the bundled ad system.

## 1.3.0 — security hardening

Addresses the findings from the security audit (IDs reference the audit report):

- **ADF-01 (High) — payment-amount tampering on ticket checkout.** `/ticket-confirm`
  now derives the order solely from the verified PaymentIntent's metadata and
  rejects any order whose total exceeds the amount actually captured, instead of
  re-pricing from the (attacker-controllable) request body.
- **ADF-02 (High) — forged Stripe webhooks.** Unsigned webhook events are now
  rejected unless `ADF_ALLOW_UNSIGNED_WEBHOOK` is explicitly set (local dev only),
  closing free-ticket / fake-"paid" forgery when no signing secret is configured.
- **ADF-03 — check-in PIN brute force.** PIN attempts are throttled per IP+event
  (lock after 10 failures for 15 min).
- **ADF-04 — missing rate limiting / unauth upload.** Per-IP rate limits added to
  the public `ticket-intent`, `ticket-promo`, `volunteer-signup` and `ad-book-intent`
  endpoints; ad-booking uploads are now size- (≤5 MB) and MIME-checked before
  hitting the media library.
- **ADF-05 — secrets at rest.** API keys and the GitHub token are now encrypted in
  the database with libsodium (`Crypto`), keyed off `ADF_ENCRYPTION_KEY` or the WP
  salts. wp-config constants remain the recommended, DB-free option.
- **ADF-06 — confirm-payment authorization.** A listing's payment can only be
  confirmed by its own submitter.
- **ADF-07 — log hygiene.** The debug logger redacts sensitive keys and truncates
  long values (e.g. API response bodies).
- **ADF-08 — reproducible builds.** `composer.lock` is now committed so release
  builds pin exact dependency versions.

## 1.2.0

- **Editable API keys in admin** — Settings → API keys now has fields for the
  Stripe / Brevo / Claude / Google Maps keys with a show/hide (eye) toggle. A
  wp-config.php constant still wins where defined and locks its field; otherwise
  the entered key is stored in the database.
- **Automatic table upgrades** — a DB-version check (`ADF_DB_VERSION`) builds any
  new/changed tables on load via idempotent `dbDelta`, so updates no longer need a
  manual deactivate/reactivate. (1.0.0 → 1.2.0 sites get the ticketing/ads tables
  automatically.)
- **Bundled QR libraries** — `qrcode.min.js` (qrcodejs) and `html5-qrcode.min.js`
  are now shipped, so printed tickets render scannable QR codes and the check-in
  camera scanner works out of the box (no external CDN).

## 1.1.0

Major feature release — full Event Tickets + Ad Manager parity, backend manual
entry throughout, a door check-in PWA, and AI tone-of-voice training.

**AI Stories**
- Editable tone-of-voice training: a house style guide + example pieces feed
  Claude's system prompt on every generation, with a live "Test the voice" box.

**Ticketing (now relational: `adf_orders` / `adf_tickets` / `adf_checkins` / `adf_promo_codes`)**
- Multiple ticket types per event — price, sale price, "admits N" group tickets,
  per-type capacity and sale windows, event-wide sale close, check-in venues + PIN
  (event meta box).
- Orders → tickets model with unique 64-hex tokens; promo codes (percent/fixed,
  event-scoped, expiry, max-uses).
- Public Stripe checkout (`[adf_event_checkout]`) with server-side re-pricing and a
  webhook backup; order-confirmation email.
- Admin Registrations screen with manual comp/paid order entry, cancel + Stripe
  refund, CSV export; Promo Codes CRUD; sales totals + daily sales report.
- QR check-in PWA (`[adf_checkin]`): PIN-gated, camera scanning with manual
  fallback, valid/already/invalid overlays, check-in log.

**Ads (now `adf_ad_campaigns` / `adf_ad_creatives` / `adf_ad_tracking` / `adf_ad_bookings`)**
- Campaign + creative CRUD with a media-library picker (full manual entry),
  cap-aware random rotation, impression/click tracking with de-duplication.
- Ad serving (`[adf_ad]`) via a cache-safe REST render; tracked click redirect.
- Self-serve booking (`[adf_ad_book]`): creative uploads + packages + promo +
  Stripe; admin Activate creates the live campaign; per-campaign report.
- Hub/partner ad syndication (API-key-gated `/ad` feed + cached partner proxy).

**Migrations** — `wp adf migrate-tickets` / `migrate-ads` now import the legacy
plugins' real tables 1:1 (preserving ticket check-in tokens).

**Note:** the relational ticketing/ads tables are created on activation. Since
1.0.0 is already live, deactivate/reactivate once after updating to create the
new tables, then run the migrations.

## 1.0.0

Initial release: accounts, listings (directory/destinations/products/events/
stories), submission/approval, Stripe payments, Brevo email + SMS, volunteer
opportunities with shift signups and reminders, the AI Stories connector, the
Destinations map, the monthly digest, WP-CLI migrations, and the GitHub
self-updater.
