# October Festival Platform — page-by-page walkthrough

A map of every screen across the whole system, what each one does, what data it
reads/writes, how it connects to the others, and where the seams are. Use it to
walk the product page by page and spot anything missing or wrong.

> **Scope.** This covers two code apps that share one data layer:
> - **October Events** — the WordPress plugin (`dev/october-events/`). It owns the
>   database, the REST API, all wp-admin screens, and the public-facing pieces
>   (checkout, tickets, check-in, support chat).
> - **October Platform** — the standalone SPA (`dev/october-platform/`) on
>   Cloudflare Pages. It's a *second front-end* onto the same plugin data, for
>   staff who don't live in wp-admin.

---

## 1. The big picture

There are **three surfaces**, all backed by the **same plugin database**:

```
                    ┌─────────────────────────────────────────────┐
                    │   October Events plugin (WordPress site)     │
                    │                                              │
   wp-admin  ─────► │   • Custom tables: orders, tickets, checkins │
   (staff in WP)    │     campaigns, messages, contacts, +meta     │ ◄──── Public site
                    │   • Post types: directory, destination,      │       visitors
                    │     product, event, story, (ad), volunteer   │       (checkout,
                    │   • REST API  oe/v1/*                         │        tickets,
   Platform SPA ──► │   • Connectors: Stripe, Claude, SES, SMS,    │        support chat)
   (staff anywhere) │     Maps, Chatwoot, SNS                       │
   via App Password │                                              │
                    └─────────────────────────────────────────────┘
```

- **wp-admin** and the **Platform SPA** are two doors into the same rooms. The SPA
  is a focused, on-brand subset (planning, tasks, volunteers, email, contacts,
  assistant); wp-admin is the full back office (accounts, approvals, listings,
  promo codes, settings, …).
- The SPA talks to the plugin over REST (`oe/v1/*`) using a **WordPress Application
  Password** (Basic auth). It can connect to **multiple sites** and switch between
  them.
- The **public site** (the festival's actual website, built with Elementor/JetEngine)
  embeds the plugin's shortcodes and hits the same REST API for checkout etc.

**Data flows one way for truth:** the plugin DB is the source of record. Both
front-ends read and write it; neither stores its own copy.

---

## 2. Surface A — wp-admin (the October Events plugin)

One top-level menu (named after the site's brand, e.g. "Atlanta Design Festival"),
with these screens. Each gets the OMI admin styling and a "what you can do here"
bento at the top.

| # | Menu item | Slug | What it does |
|---|-----------|------|--------------|
| 1 | **Dashboard** | `october-events` | Landing screen — at-a-glance counts (listings, events, ticket sales, tasks) and quick links. |
| 2 | **Accounts** | `oe-accounts` | The businesses/people who submitted listings — their profile, Stripe customer id, and what they've submitted. |
| 3 | **Approval Queue** | `oe-queue` | Pending listing submissions waiting for a yes/no. Approve → publishes; reject → emails the submitter the (editable) rejection copy. |
| 4 | **Directory** | `oe-directory` | Manage the *directory* listing type (the design-business directory). |
| 5 | **Destinations** | `oe-destinations` | Manage *destination* listings. |
| 6 | **Products** | `oe-products` | Manage *product* listings. |
| 7 | **Events** | `oe-events` | Manage *event* listings (the raw CPT records). |
| 8 | **Event Planning** | `oe-planning` | The readiness board: every event with a draft → in-progress → confirmed (green) status, a % complete, and what each still needs. Confirming publishes it. |
| 9 | **Tickets** (Registrations) | `oe-tickets` | Ticket orders/registrations — who bought what, status, refunds, resend. |
| 10 | **Promo Codes** | `oe-promos` | Discount codes applied at checkout. |
| 11 | **Volunteers** | `oe-volunteers` | Volunteer opportunities, their shifts, capacity vs filled, and signup decisions. |
| 12 | **Tasks** | `oe-tasks` | The team's shared task board, grouped by department. |
| 13 | **Stories** | `oe-stories` | Manage *story* posts (editorial), incl. the AI Stories connector output. |
| 14 | **Email** | `oe-email` | Campaign list + builder, audiences, send/test, the AI co-pilot, plus the "send a test email" + deliverability tools. |
| 15 | **Contacts** | `oe-contacts` | The unified contact list (built automatically from accounts, ticket buyers, volunteers, submitters). |
| 16 | **Settings** | `oe-settings` | Everything configurable (see §5). |

### Notes on the heavier admin screens

- **Event Planning** (`oe-planning`) is the same model the Platform's **Events**
  page shows. "Readiness" is gated by the fields chosen in Settings → Event
  readiness. The **Event field mapping** setting lets existing JetEngine events
  count toward readiness without re-keying.
- **Email** (`oe-email`) and **Contacts** (`oe-contacts`) are the admin twins of
  the Platform's Email and Contacts pages — same data, same endpoints.

---

## 3. Surface B — the Platform SPA

A single-page app (dark sidebar + main panel) at
`platform.atlantadesignfestival.net`. Sign in with a site URL + WP username +
Application Password. Supports multiple connected sites with a switcher. Every
page has a dismissible "what you can do here" bento.

| Nav item | Route | What it does | Backed by |
|----------|-------|--------------|-----------|
| **Dashboard** | `overview` | At-a-glance across events/tasks/volunteers + a getting-started checklist that ticks itself off. | `GET /dashboard`, planning/tasks/volunteers |
| **Events** | `events` (`renderBoard`) | The event-readiness board (mirror of admin Event Planning): cards by status, click to edit essentials, confirm → green. | `/planning/events`, `/planning/event/{id}`, `…/confirm` |
| **Tasks** | `tasks` | The shared department task board: add, assign, move across To do → In progress → Blocked → Done. | `/tasks`, `/tasks/meta`, `/task/{id}` |
| **Volunteers** | `volunteers` | Opportunities with shift coverage; confirm/decline/no-show signups; add a volunteer manually. | `/volunteers/opportunities`, `…/opportunity/{id}`, signups |
| **Email** | `email` | Campaign list + the builder (see below) + AI co-pilot + send/test. | `/campaigns*`, `/audiences`, `/campaigns/copilot` |
| **Contacts** | `contacts` | Search the unified list, see each contact's source, manage consent. | `/contacts`, `/contacts/meta`, `/contact/{id}` |
| **Assistant** | `assistant` | Staff AI chat with tool-access to live data (events, sales, orders, failed payments, contacts, volunteers, campaigns). Read-only. | `POST /assistant` |

### The email campaign builder (inside **Email → open/new campaign**)

Two editing modes, switched at the top:

1. **Simple builder** — block by block: heading, text, image, button, **columns**,
   **social**, divider, spacer, with per-block alignment. Live preview on the right.
   The **AI co-pilot** drafts the whole thing from a plain-language brief, grounded
   only in real confirmed events/links.
2. **Advanced (drag & drop)** — a full visual HTML editor (GrapesJS + newsletter
   preset), lazy-loaded. Pixel-level control for rich newsletters.

Either way, **what gets sent is `body_html`**. Simple mode renders blocks → inlined
HTML; advanced mode exports inlined HTML from the canvas. The send path never cares
which editor produced it.

---

## 4. Surface C — public-facing (on the festival's own website)

These are embedded on the public WordPress site (via shortcode) or served by the
plugin's front routes.

| Surface | How it's placed | What it does |
|---------|-----------------|--------------|
| **Event checkout** | `[oe_event_checkout event_id="…"]` | Ticket-type chooser, quantity, promo field, buyer details, Stripe card element. Creates the order + tickets on payment. |
| **Ticket view** | `?oe_ticket=<token>` | A single ticket page with its QR code (for scanning at the door). |
| **Check-in app** | `[oe_checkin]` | Staff-facing QR scanner to check attendees in on the day; live stats. |
| **Account dashboard** | `[oe_account_dashboard]` | A submitter's self-serve area: their listings, tickets, invoices. |
| **Volunteer signup** | `[oe_volunteer_signup]` | Public widget to sign up for a volunteer shift. |
| **Design map** | `[oe_design_map]` | A Google map of listings/destinations. |
| **Invoice download** | `?oe_invoice=<listing_id>` | Owner-only invoice HTML for a paid listing. |
| **Support chat** | floating widget (Settings toggle) or `[oe_support_chat]` | Customer AI chat: verify by emailed code → ask about *your own* orders/tickets → "Talk to a person" hands off to Chatwoot. |
| **Email tracking / unsubscribe** | `?oe_o=`, `?oe_c=`, `?oe_unsub=` | Open pixel, signed click-redirect, one-click unsubscribe (RFC 8058). |

---

## 5. Settings (`oe-settings`) — the control panel

Grouped sections:

- **Brand** — the per-site name shown in the menu/UI.
- **Event readiness** — which fields an event needs before it can go green.
- **Event field mapping** — map existing (JetEngine) meta keys so old events show
  real readiness. (Then "Seed planning from existing fields" on Event Planning.)
- **API keys** — Stripe (×3), Claude, Google Maps. Enter here *or* pin in
  `wp-config.php` (a constant wins and locks the field). Stored keys are encrypted.
- **Tier pricing / currency** — listing pricing.
- **AI Stories connector** — source URLs + the trained "house voice" + examples,
  with a live "test the voice" tool.
- **Rejection email copy**, **Volunteer reminders**, **Digest & reports**.
- **Updates (GitHub)** — self-updater repo/token + a connection test.
- **Planning platform (CORS)** — the allowed origins for the SPA.
- **Email sending (Amazon SES)** — SMTP transport, from name/email, footer address.
- **SMS (AWS End User Messaging)** — keys, region, origination number.
- **AI support chat** — toggle the public customer chat widget.
- **Live chat (Chatwoot)** — base URL + token for the human hand-off.
- **Branding (platform theme)** — colours, logos, font (incl. uploaded font file),
  exposed read-only to the SPA via `GET /brand`.

---

## 6. The connectors (external services)

| Connector | Used for | Configured by |
|-----------|----------|---------------|
| **Stripe** | Ticket payments, refunds, the assistant's failed-payments view | Stripe keys + webhook secret |
| **Claude** | AI co-pilot (email), staff assistant, customer support chat, AI Stories voice | `claude_api_key` |
| **Amazon SES** | Outgoing mail transport: transactional + campaigns | SES SMTP creds + `ses_enabled` |
| **Amazon SNS** | SES bounce/complaint feedback (`/ses-sns`, SigV4-verified) | wired to SES |
| **AWS End User Messaging** | SMS (volunteer reminders) | AWS keys + origination |
| **Google Maps** | The public design map | `google_maps_key` |
| **Chatwoot** | Human hand-off from the support chat (and standalone site chat) | base URL + token |
| **GitHub** | Plugin self-updater (releases `oe-v<version>`) | repo + token |

---

## 7. How it all connects — key flows

**Authentication (SPA → plugin).** SPA stores `{base, user, appPassword}` per site,
sends Basic auth to `oe/v1/*`. CORS is handled by `OE\Cors` (sends exactly one
allowed origin from the Settings list). Theming is pulled from the public
`GET /brand`.

**A ticket sale.** Public checkout (`[oe_event_checkout]`) → `/ticket-intent` →
Stripe PaymentIntent → card confirm → `/ticket-confirm` (or the Stripe webhook)
creates the **order + tickets**, emails the ticket(s) via SES, and **captures the
buyer as a contact**. The buyer can later open the support chat, verify by email,
and ask about that order.

**An email campaign.** Build in Email (simple or advanced) → save (`body_html` +
`body_json`) → send → throttled background cron dispatches per-minute, writing to
the `messages` table; opens/clicks/unsubscribes tracked via the public routes;
bounces/complaints arrive from SNS and suppress addresses.

**Event readiness.** Edit essentials in Event Planning *or* the SPA Events board →
when all required fields are present, **Confirm** flips status to green and
publishes the event to the public site.

**The assistants share an engine.** The **staff** assistant (full data, `edit_posts`
only) and the **customer** chat (scoped to one email-verified order) both run
Claude's tool-use loop. The customer one binds the verified email into every tool
so it can never read another customer's data, and escalates to Chatwoot.

---

## 8. Review checklist — things to confirm as you walk it

Open questions worth a deliberate look (not necessarily problems — prompts):

1. **wp-admin vs SPA overlap.** Events, Tasks, Volunteers, Email, Contacts exist in
   both. Is that the intent (two doors), or should the SPA be the only place staff
   do some of these? Any screen that should be SPA-only or admin-only?
2. **Dashboard (both).** Do the at-a-glance numbers match what you'd actually want
   first thing in the morning? Anything missing (e.g. revenue target, today's
   check-ins, campaigns sending)?
3. **Accounts vs Contacts.** Accounts = submitters with logins; Contacts = everyone
   reachable by email. Is the relationship between them clear, or confusing?
4. **Approval Queue.** Does the approve/reject flow cover everything (edits before
   approval, re-submission, partial info)?
5. **Listings (Directory/Destinations/Products/Events/Stories).** These wrap the raw
   CPTs. Is anything you manage day-to-day missing a screen?
6. **Event Planning field mapping.** Have the JetEngine meta keys been filled in so
   existing events show real readiness? (Currently the most likely "everything shows
   0%" gotcha.)
7. **Tickets.** Refund, resend, manual/comp tickets, check-in status — all present
   where you'd reach for them?
8. **Email deliverability.** SES verified domain, SPF/DKIM/DMARC, the footer mailing
   address (CAN-SPAM), and a real unsubscribe — confirm before any real send.
9. **Support chat scope.** Confirm the customer chat only ever shows the verified
   customer's own data, and that the hand-off lands in the right Chatwoot inbox.
10. **Public pages.** Checkout, ticket, check-in, account dashboard, volunteer
    signup, map — are they all actually embedded on the live site where they belong?
11. **Multi-site.** If this runs on more than one festival site, does each get its
    own brand, theme, keys, and data cleanly?
12. **Permissions.** Today most admin screens use one capability and the SPA needs
    `edit_posts`. Do you need finer roles (e.g. volunteers lead vs box office)?

---

*Generated as a living map — tell me which page to drill into and I'll expand that
section (fields, buttons, edge cases) or fix anything that's wrong.*
