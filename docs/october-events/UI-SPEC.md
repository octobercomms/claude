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
- **To build (not yet mocked):** a **live preview** pane on the right that
  renders the public page via the same section renderers as fields are edited,
  plus **example placeholders** per field for new organizers.

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
- **To build:** refund / cancel / delete **confirm steps** (amount + reason;
  cancel asks "refund too?"; delete needs a typed confirm and is logged).

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

**URL scheme (decided): descriptive per-type bases**, one engine, each base
configurable, with 301 redirects from the old `/e/` and `/portfolio/`:
`/events/`, `/tours/`, `/locations/`, `/directory/`, `/destinations/`.
Consistency lives in the code (one template), not in a single-letter URL;
descriptive slugs win on SEO and clarity.

**Categories:** the category taxonomy carries a per-term colour and drives the
archive filter chips, colour-coded.

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
- **Empty states / owner first-run**: every screen's empty state and the
  first-run path for a new install/tenant.
- **Transactional email lifecycle**: much exists (SES platform + confirmations);
  **audit what's built and fill gaps** rather than redesign.
- **Confirm / validation / error states**: the refund/cancel/delete confirms and
  form-failure states above.
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
- Add: audit/error/email logs, schema.org, tax/VAT, accessibility, GDPR.
