# UI spec: October Events admin and front-end

Status: **active design spec**. Owner: Daniel. Plugin: `dev/october-events`.
Companion to [`EVENT-MODEL.md`](EVENT-MODEL.md) (data model),
[`FIELD-MAPPING.md`](FIELD-MAPPING.md) (fields/migration) and
[`BUILD-PLAN.md`](BUILD-PLAN.md) (build order). This doc is the single reference
for *what each screen is and how it behaves*, so the build follows the agreed
mockups instead of drifting.

Interactive mockups (private artifacts, owner access):
- **Admin:** https://claude.ai/artifact/VfoBuBFqeiFqWjR8tvxE1o
- **Front-end:** https://claude.ai/artifact/AfRxu97Ttr6rz5PkGKF7Sj

Design language: the October house style (`.claude/skills/october-design-system`),
accent overridden to the plugin's orange. Admin is the WordPress admin (light
content, dark submenu rail); the front-end surfaces are branded pages, never
wp-admin.

---

## 1. The model in one paragraph

One **listing engine**. Every public content object (event, tour, tour location,
destination, directory entry) is a *listing*. Its **listing-type** is a preset
that switches on the right **capability packs** (Tickets, Tour/multi-location,
Conference, Exhibition, Volunteers, Staff, Map, Contact/Directory). Shared parts
(hero, gallery, title, meta, body, map, credits, CTA) come from one set of
**sections**; type-specific parts are packs. Each section is a **shortcode, a
Gutenberg block and an Elementor widget** behind one renderer. Sections **do not
load when empty** (pack off, or on with no content) — the renderer short-circuits
before any query or markup, so one template serves every listing and each page
composes itself from whatever content exists. This is the capability-pack model
([`EVENT-MODEL.md`](EVENT-MODEL.md)) extended from events to all listings.

**Products are removed** from the plugin (they live on the store / Shopify).

---

## 2. Global admin UI rules

- **Clean page title, no explainer bentos.** The dark "what you can do here"
  cards are gone from every page. A plain title and subtitle.
- **Keep the data stat row.** The white/black stat tiles (tickets sold, revenue,
  checked in, …) stay — that data-highlight row is useful.
- **Navigation is the wp-admin submenu**, not in-page tabs. (The mockups' top
  switcher is only a mockup device.)
- **Settings in context.** Each page's settings live in a collapsible accordion
  at the top of that page; only truly global settings stay on Settings.
- **One reusable right slide-in** for record detail and quick actions, used
  across Tickets, Accounts, CRM, Team, Volunteers, the listing editor.
- **Light look only.** No dark-mode toggle; the admin is the light wp-admin UI.
- **Full-width, responsive pages.** Admin screens use the full content width (no
  fixed max-width) and reflow down to a narrow viewport, so wide tables and the
  split-pane editor have room on large screens and stay usable on small ones.

---

## 3. Admin screens

### Dashboard
Pure overview and data (no action buttons — those live on their own pages).
- Stat row: tickets sold, revenue, subscribers, events live.
- **Sales analytics lives here** (it is data, not an action): a **date-range
  selector** (7 / 30 / 90 days, year to date, all time, custom from–to) driving a
  sales-over-time chart; sales by event; a ticket-price stat row (tickets / free %
  / paid / avg per ticket / avg paid / revenue); a price-paid breakdown; a
  "distinct prices paid" accordion; a year-over-year pacing accordion; the
  85%-free heads-up.
- Approval queue, by-listing-type table.

### Listings (was Events)
List of all listings with **capability badges** per row and **category** chips
(coloured from the category taxonomy's per-term colour). Filter by type / status /
category / upcoming|past. Row click opens the editor. `+ New` and (on the Events
view) a **Countdown** button opening a create-in-modal slide-in.

### Listing editor (the M1 centrepiece)
One editor for every listing type.
- **Capabilities**: per-pack toggles that reveal field groups. Each pack shows its
  **shortcode(s)** in the switch row and group header.
- **Page sections & shortcodes** reference card, always visible: every section
  (base always-on + each pack's sections), its shortcode, on/off state, and a
  **Copy** button. Notes that each is also an Elementor widget / Gutenberg block
  and that sections auto-hide when empty.
- **Base details** + **structured fields**: link-aware credits (`{name,url}`,
  incl. `realtor`), availability (Saturday/Sunday/Both/Specific), preset status
  badge (`{text,preset}`, dropdown not raw colour). No pasted HTML.
- **Pack field groups** revealed per toggle (Tickets tiers; Conference about/
  speakers/past-speakers/sessions/accommodation; Exhibition exhibitors; Tour
  details + **locations manager**; Volunteers shifts; Staff role page).
- **Tour pack → location editor** (slide-in): availability, preset status badge,
  link-aware credits (architect…realtor), address/parking/maps, gallery, alert,
  guided-tour toggle + slots (+ add / generate a run), the **Volunteers box**
  (needs volunteers, slots, this-site/partner-site), post-event survey toggle.
- **Live preview** (mocked): a split pane on the right that renders the public
  page via the same section renderers, updating as fields are edited (name, price,
  availability, status badge, which packs are on). **Example placeholders** sit in
  empty fields so a new organiser sees the shape of a finished listing.

### Tickets
One page, actions on it; data analytics moved to the Dashboard.
- Stat row (tickets / checked in / not in / revenue). Event filter chips.
- **One table, three lenses** via a segmented toggle: **Attendees / Orders /
  Check-in log** (this merges the old separate tabs). Filter + search apply to all
  three. Row click opens the slide-in.
- **Order slide-in = the control centre:** actions **Resend all tickets,
  Invoice (PDF), Transfer, Refund, Cancel order, Delete**; summary with
  subtotal/discount/total; **payment detail** (card brand + last 4, expiry, name,
  Stripe id, AVS/CVC, risk); promo code; per-ticket list with Resend each; and a
  **detailed history timeline** (cart created, promo applied, failed attempt with
  decline reason, retry, 3-DS, payment succeeded, QRs issued, confirmation sent,
  invoice generated), colour-coded.
- Actions as slide-ins: **Add order**, **Message attendees** (compose, sends only
  on click — never auto-send).
- Secondary modules as accordions: Guided tours, Waitlist, Promo codes.
- **Confirm flows** (mocked): refund (full / partial amount + internal reason,
  void-tickets and email-customer toggles), cancel order (reason, "also refund?"
  toggle, "email the holder?" toggle, releases seats to the waitlist), delete
  (typed `DELETE` confirm, audit-logged, holder email off by default — steers to
  refund/cancel for money taken). Event-level **reschedule / cancel** opens a
  confirm that always asks **"notify N holders?"** (and, on cancel, "refund all
  paid orders?") before any message to the whole holder list goes out.

### CRM (was People hub)
The CRM. One record per person, unifying customers, volunteers, crew, contacts
(per entity, never merged festival ↔ tours).
- `+ Add person`, **Import CSV** (column mapping, duplicates merge on email),
  **Export**.
- **Groups** as segment chips with counts. `+ New group` as **manual** or
  **smart** (rule-based): a small rule builder (field + condition + value, matched
  all), with a live "estimated N people match" count.
- Row click → unified person record (orders, shifts, roles, email history);
  footer **Compose message** (opens a composer, sends only on click).

### Team (was Crew & team)
Planning team, council, board. Lifecycle table (role, person, term, login,
status); row → role lifecycle slide-in (agreement, login, role email, renewal /
offboarding). Council and board are display only. Detail in
[`CREW-MODULE.md`](CREW-MODULE.md).

### Volunteers
Stat row; one table with a lens toggle (Opportunities / Signups / Profiles);
profile slide-in with the no-show/abuse flag; pool & allocation and settings as
accordions.

### Accounts
Customer accounts list; row → the shared person record.

### Email
Native SES. Campaigns table; `+ New campaign` slide-in with the Claude co-pilot;
accordions for Contacts & segments (shared with the CRM), Templates, and the
**Email log** (global `wp_mail` capture, retires Check & Log Email).

### Ad Manager (Phase G)
House ad units + hub/partner syndication; `[oc_ad]` back-compat preserved.

### User access
Section-level capabilities enforced on the API (not just hidden): role presets
(Director / Lead / Door crew / Organizer) + a per-person capability grid. Non-owner
roles never reach wp-admin (admin bar off, wp-admin redirects to the portal).

### Taxonomies & filters
Where the admin configures what the public archives filter by, **per listing
type** (a tour's filters differ from a directory's). A table of taxonomies, each
with its terms, a **per-term colour**, a **"show as filter"** toggle, a **control
type** (chips / dropdown / checkboxes) and a display order. `Manage terms` opens a
slide-in. This is what lets a site owner decide that tours filter by year /
city / building-type while the directory filters by architect / builder / store,
without touching code. Per-type CPTs make each type's taxonomies native WordPress
registrations.

### Import / export
Data portability, both directions, no lock-in. An **export** card (pick type +
format, download) and an **import** card (upload CSV/JSON, map columns to fields,
**dry-run diff** before commit, duplicates merge on a chosen key). **Saved mapping
templates** so a recurring source maps once and reruns. The owner's own migration
is just one saved template, so getting data in from another platform and back out
of this one use the same screen.

### Settings
Global only (brand, payments/keys, adoption mode). Per-page settings moved into
each page's accordion. Entitlement tier / licensing stubbed for the sell-to-others
phase.

---

## 4. Front-end surfaces

Branded pages and logged-in portals, never wp-admin.

### Section shortcodes (the embed system)
Base (always available): `[oe_event_header]`, `[oe_event_gallery]`,
`[oe_event_register]`. Pack sections: `[oe_event_tickets]`, `[oe_event_about]`,
`[oe_event_speakers]`, `[oe_event_past_speakers]`, `[oe_event_schedule]`,
`[oe_event_accommodation]`, `[oe_event_exhibitors]`, `[oe_tour_locations]`,
`[oe_event_map]`, `[oe_event_volunteers]`, `[oe_event_staff]`. Each binds to the
current listing by default (`id="…"` to target another), is also an Elementor
widget and Gutenberg block, and **renders nothing when empty**.

- **Option A (turnkey):** one ready-made single-listing template holding every
  section; each listing shows only its on-packs.
- **Option B (bespoke):** drop shortcodes/widgets into a custom layout.
- Both ship. Styling ladder: inherit theme → default styling → brand tokens
  (accent/font/radius) → Elementor widget styling → template override.

**The "native, not an embed" contract.** The goal is that a dropped section reads
as part of the client's site, not a third-party plugin. On a bespoke site (e.g.
Concrete Communities: huge CC logo, per-event pastel chrome, Neue Haas Unica,
editorial table) Option B is the only sane choice; Option A would flatten the
identity. The output must honour:
- **Semantic, inheriting markup.** Text and colour inherit from the theme by
  default; no wrapper that resets type/colour, no fixed widths.
- **No plugin chrome on the front end.** No "powered by", no October styling, no
  forced card/box. The admin is October-branded; the front end is the client's.
- **Each section is an Elementor widget**, so its frame (padding, width, heading
  type) is styled in Elementor, the tool the client already uses.
- **Design tokens drive the functional parts** (ticket rows, pay button), and the
  **same tokens feed the Stripe Elements appearance API** so the card iframe
  matches too (site CSS cannot reach inside that iframe; tokens can). Tokens are a
  small set (accent + accent-text, font source, radius, border width, button
  style/shape, control height, spacing), set per-site and overridable per section.
- **Part-classes as the escape hatch** (`.oe-ticket-row`, `.oe-checkout__pay`, …)
  for the last 10% via Elementor custom CSS.
- **Explicitly not** a per-element CSS editor in settings — that rebuilds Elementor
  inside wp-admin and loses to it. Tokens + Elementor + part-classes cover it.

**Checkout styling.** The native Stripe checkout is a section like any other:
inherits the theme, styled by tokens + the Stripe appearance API, framed in
Elementor. This is how a site keeps native payments feeling like its own page
rather than an EventBrite-style embed, without a fully bespoke build.

### Public listing page
Composed from the sections. A tour is simply a listing with the Tour pack on, so
it gets the standard sections (header, about, tickets) **plus** Locations and Map.
Shown in the mockup with per-section shortcode labels and a "dynamic visibility"
toggle.

### Listing archives + filters
Native filtering replacing JetSmartFilters: filter by category (coloured chips),
type, year, city, upcoming|past; a filterable past archive. The Directory is a
listing archive with its own filters so it can grow beyond the current list.

### Tour locations: slide-in + permalink
On a tour page, the location grid and the map pins both open the **same slide-in**
(fast preview: gallery, availability badge, link-aware credits, maps buttons,
guided-tour slots). **Each location also has its own permalink**, server-rendered
and crawlable; the slide-in deep-links to it (pushState) and offers "view full
page". The permalink page is canonical; the slide-in is an enhancement over it.

### Team portal
Role-scoped. Director sees everything; Lead sees their volunteers + check-in;
Door crew sees only the scanner. Capabilities enforced on the API.

### Organizer / partner portal (LDF-modelled)
- **Overview**: welcome, a **partner checklist** (staged deliverables, deadlines,
  statuses; activities locked until payment), **key dates**.
- **Packages**: a **comparison matrix** of tiers (incl. subsidised Charities /
  Launch Pad), +VAT, "buy more than one", information-pack download. Choose opens
  a **multi-step purchase wizard** (Package → Company → Contact → T&Cs → Payment).
  Paying unlocks activities.
- **Activities**: their listings (submit / edit-own with ownership guard /
  signups). Gated until a package is paid; a **managed-free / handling-fee tier**
  must still unlock activities so small studios and charities aren't blocked.
- **Briefings**, **Account**.

### Attendee view
Tickets with QR (wallet / PDF), order history, update details.

---

## 5. The unified listing model

| Listing type | Preset packs | Notes |
|---|---|---|
| Event | Tickets, Conference, Exhibition, Volunteers (as switched) | The base case |
| Tour | Tour (locations + map) + Tickets + Volunteers | Multi-location event |
| Tour location | Credits, Map, Guided-slots, Volunteers | Sub-item of a tour; its own permalink |
| Destination | Map; no date (permanent) | Like an event listing but permanent + map |
| Directory | Contact/Directory (socials, website, address); tickets off | Already a plugin listing CPT; add filters |

Code already leans this way: `PostTypes::TYPES` flags `listing => true` for
directory/destination/product, with a shared `listing_type` field and a working
Submission/approval pipeline. The work is to (a) remove product, (b) fold events
and tour locations into the same listing abstraction, (c) build one shared
template + archive + filters.

**Storage decision (confirmed): one listing engine, per-type CPTs.** The shared
engine (packs, sections, archive, template, filters, taxonomies) is one codebase;
storage stays one native `register_post_type()` per type. "One engine" is not
"one CPT". Per-type CPTs are plain WordPress registration the plugin already does
(`PostTypes.php`), so this needs **no CPT-builder UI and no JetEngine** — the
plugin registers the types itself, which is what lets it run on a simple
WordPress install with no Crocoblock stack. Descriptive per-type URLs and
per-type taxonomies fall out of this cleanly.

**URL scheme (decided): descriptive per-type bases**, one engine, each base
configurable, with 301 redirects from the old `/e/` and `/portfolio/`:
`/events/`, `/tours/`, `/locations/`, `/directory/`, `/destinations/`.
Consistency lives in the code (one template), not in a single-letter URL;
descriptive slugs win on SEO and clarity.

**Categories:** the category taxonomy carries a per-term colour and drives the
archive filter chips, colour-coded.

**Second reference tenant (Concrete Communities).** CC runs the same ACF field
shape as ADF (`event_number`, `event_colour` + `event_colour_image`,
`event_ticket_link` + text, `event_date`, `event_location`) under a radically
different skin, which validates "productise in place, don't fork" and surfaces
three fields the single-tenant model missed. All three are M1/M2 work:
- **Per-listing brand colour + image** as optional base fields, exposed as an
  **Elementor dynamic tag** (CC paints the whole page from `event_colour`; today
  a JetEngine/Crocoblock binding, which must be reproduced as a plugin dynamic tag
  or the page goes grey on de-Jet). This is distinct from the category colour and
  the status-badge preset.
- **Ticketing external-link mode**: the Tickets pack must degrade to a button to
  an external URL (`ticket_link` + text) as a first-class alternative to native
  checkout, so a site can list without selling natively, or move to native later.
- **Reference number / light custom fields** (`event_number`, "013").

**Performance:** sections render on demand and short-circuit when empty, so an
unused section costs a cheap meta check, not a query or markup. Add per-section
object caching and lazy images. This is faster than the current render-then-hide
(JetEngine dynamic visibility).

---

## 6. Cross-cutting, to build

- **Audit log, error log, email log.** Email log has an engine already; add the
  global `wp_mail` capture + screen, and build the audit log (who refunded /
  deleted / changed access) and an error log.
- **Schema.org** markup per listing type (Event / Place), sitemaps, canonical on
  the slide-in/permalink pattern.
- **Tax / VAT** config per tenant (USD no-tax for ADF; GBP + VAT for a UK tenant).
- **Accessibility**: keyboard nav, screen-reader labels, and the orange-on-white
  contrast (borderline for small text — verify AA).
- **GDPR**: consent capture + data export/erasure (subject requests) for the CRM.
- **Empty states / owner first-run** (mocked): a Dashboard first-run checklist
  (brand → payments → first event → sending identity → first public page;
  self-dismisses when done, always skippable), and a per-screen empty state that
  names the thing, says in one line why it's worth doing, and gives the single
  action that fills it (Events, Tickets, Volunteers, CRM, Email, and the
  no-search-match state). Error and permission-denied states follow the same
  shape.
- **Transactional email lifecycle**: much exists (SES platform + confirmations);
  **audit what's built and fill gaps** rather than redesign.
- **Confirm / validation / error states** (confirms mocked, above): form-failure
  and inline-validation states still to mock.
- **Live preview + example placeholders** in the listing editor.

---

## 7. Decisions log (this design pass)

- Dashboard: remove explainer bentos, keep stat row, move full sales analytics
  here with a date-range selector.
- Tickets: merge Attendees/Transactions/Check-in into one table + lens toggle;
  rich order control-centre slide-in; message = compose, never auto-send.
- Rename: People hub → **CRM**; Crew & team → **Team**.
- Countdown moved onto Events (create-in-modal).
- CRM: add person / import / export; manual + smart groups with a rule builder.
- Front end: section shortcodes + Option A/B; dynamic visibility = conditional
  load, not hide; slide-in + permalink for tour locations; team + organizer
  (partner-journey) + attendee portals; one template for all listings.
- Shortcodes visible at all times in the editor (reference card + per section).
- **Products removed.** Directory/Destinations fold into the listing model.
- URL scheme: descriptive per-type bases with 301s.
- **Storage: one engine, per-type CPTs** (native WP registration, no JetEngine, no
  CPT-builder UI).
- **Admin-configurable filters** via a Taxonomies & filters screen, per listing
  type (per-term colour, show-as-filter, control type, order).
- **Full-width responsive** admin pages (no fixed max-width).
- **Live preview + example placeholders** now mocked in the listing editor.
- **Import / export with saved mapping templates**, both directions, no lock-in;
  the owner's migration is one saved template.
- **Messaging completeness** (approved): emailed receipts + PDF invoices, dunning,
  full membership lifecycle, transfer notice, rescheduled/cancelled auto-notice,
  waitlist offer (+ fix `waitlist_spot` missing subject), removed-shift notice,
  configurable double opt-in, GDPR confirmations, enable monthly digest, SMS
  beyond volunteers on opt-in. Detail in [`BUILD-PLAN.md`](BUILD-PLAN.md) M6.
- **Reporting & insight** phase (approved): end-of-event report, demographics,
  survey, volunteer pool. [`BUILD-PLAN.md`](BUILD-PLAN.md) M7.
- **Empty states + first-run checklist** and the **refund / cancel / delete +
  event reschedule/cancel confirm flows** (with the "notify N holders?" step from
  the email audit) now mocked in the admin artifact.
- **Native, not an embed** (front-end contract): Option B for bespoke sites;
  presentation-light plugin; sections inherit the theme, carry no plugin chrome,
  are Elementor widgets, and are themed by a small token set (which also feeds the
  Stripe appearance API) plus part-classes. No per-element CSS editor in settings.
- **Concrete Communities = second reference tenant**, adding three model fields:
  per-listing brand colour/image (+ Elementor dynamic tag), ticketing
  external-link mode, and a reference number / light custom field.
- Add: audit/error/email logs, schema.org, tax/VAT, accessibility, GDPR.
